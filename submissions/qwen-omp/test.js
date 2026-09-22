// End-to-end tests: spawns the real server against a temp database, then drives the API over HTTP.
import { spawn } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DAY = 86400000;
let passed = 0;
let failed = 0;
let cookie = '';

function t(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function api(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.includes('Max-Age=0') ? '' : sc.split(';')[0];
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}

const port = await freePort();
const PORT = port;
const dbPath = join(mkdtempSync(join(tmpdir(), 'aldbury-')), 'library.db');

const child = spawn('node', ['--no-warnings', 'server.js'], {
  env: { ...process.env, PORT: String(port), DB_PATH: dbPath, AUTH_LIMIT: '1000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

let up = false;
for (let i = 0; i < 100 && !up; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/locations`);
    up = r.ok;
  } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 100));
}
if (!up) {
  console.error('Server did not start:\n' + serverOut);
  child.kill();
  process.exit(1);
}

try {
  // 1 — auth
  let r = await api('POST', '/api/auth/register', { name: 'Test One', email: 'test.one@example.com', password: 'test-password-1' });
  t('register', r.status === 201, JSON.stringify(r.data));
  r = await api('POST', '/api/auth/register', { name: 'Test One', email: 'test.one@example.com', password: 'test-password-1' });
  t('duplicate email → 409', r.status === 409);
  cookie = '';
  r = await api('POST', '/api/auth/login', { email: 'test.one@example.com', password: 'wrong-password' });
  t('bad password → 401', r.status === 401);
  r = await api('POST', '/api/auth/login', { email: 'test.one@example.com', password: 'test-password-1' });
  t('login', r.status === 200, JSON.stringify(r.data));
  r = await api('GET', '/api/me');
  t('me', r.status === 200 && r.data.name === 'Test One');

  // 2 — catalog
  r = await api('GET', '/api/locations');
  t('three locations', r.status === 200 && r.data.length === 3);
  r = await api('GET', '/api/books?limit=24');
  const first = r.data.books?.[0];
  const author = first?.author.split(' ').pop() || '';
  t('5,000+ books seeded', r.status === 200 && r.data.total >= 5000, `total=${r.data?.total}`);
  t('book summary shape', first && first.title && first.location?.name && 'available' in first);
  r = await api('GET', '/api/books?q=' + encodeURIComponent(author));
  t('author search', author && r.status === 200 && r.data.total > 0 && r.data.books.every((b) => (b.author + b.title + b.description).toLowerCase().includes(author.toLowerCase())));
  r = await api('GET', '/api/books?location=1&limit=5');
  t('location filter', r.status === 200 && r.data.total > 0 && r.data.books.every((b) => b.location.id === 1));
  r = await api('GET', '/api/books?order=title&limit=5');
  t('title sort', r.status === 200 && r.data.books.length > 0);
  if (!first) throw new Error('catalog empty — run `npm run fetch` first');

  // 3 — book detail
  r = await api('GET', `/api/books/${first.id}`);
  t('book detail', r.status === 200 && r.data.id === first.id && 'queue' in r.data && 'mine' in r.data);
  t('rating + review_count', 'rating' in r.data && typeof r.data.review_count === 'number');

  // 4 — reserve available
  let availableBook = null;
  let offset = 0;
  while (!availableBook) {
    r = await api('GET', `/api/books?limit=24&offset=${offset}`);
    availableBook = r.data.books.find((b) => b.available);
    if (!availableBook) offset += 24;
  }
  r = await api('POST', `/api/books/${availableBook.id}/reserve`);
  t('reserve → active', r.status === 201 && r.data.status === 'active' && r.data.due_at, JSON.stringify(r.data));
  const due1 = Date.parse(r.data.due_at);
  t('due date ≈ 21 days', Math.abs(due1 - Date.now() - 21 * DAY) < 5 * 60000);
  r = await api('POST', `/api/books/${availableBook.id}/reserve`);
  t('duplicate reserve → 409', r.status === 409);

  // 5 — renewals
  const resList = await api('GET', '/api/reservations');
  const mine = resList.data.find((x) => x.book.id === availableBook.id);
  t('my reservation listed', !!mine && mine.status === 'active');
  const dueAfterFirst = (await api('POST', `/api/reservations/${mine.id}/renew`)).data;
  t('renew advances due date', Math.abs(Date.parse(dueAfterFirst.due_at) - due1 - 21 * DAY) < 5 * 60000 && dueAfterFirst.renewals === 1);
  await api('POST', `/api/reservations/${mine.id}/renew`);
  await api('POST', `/api/reservations/${mine.id}/renew`);
  r = await api('POST', `/api/reservations/${mine.id}/renew`);
  t('fourth renew → 409', r.status === 409, JSON.stringify(r.data));

  // 6 — queue and promotion
  const cookie1 = cookie;
  cookie = '';
  r = await api('POST', '/api/auth/register', { name: 'Test Two', email: 'test.two@example.com', password: 'test-password-2' });
  t('second member registers', r.status === 201);
  const cookie2 = cookie;
  r = await api('POST', `/api/books/${availableBook.id}/reserve`);
  t('second member queued', r.status === 201 && r.data.status === 'queued' && r.data.position === 1, JSON.stringify(r.data));
  const queuedId = r.data.id;
  cookie = cookie1;
  r = await api('POST', `/api/reservations/${mine.id}/return`);
  t('return accepted', r.status === 200);
  cookie = cookie2;
  r = await api('GET', `/api/books/${availableBook.id}`);
  t('holder promoted after return', r.status === 200 && r.data.mine && r.data.mine.status === 'active' && r.data.queue === 0, JSON.stringify(r.data.mine));
  const two = (await api('GET', '/api/reservations')).data.find((x) => x.id === queuedId);
  t('second member now active', two && two.status === 'active' && two.due_at, JSON.stringify(two));

  // 7 — reviews
  r = await api('POST', `/api/books/${availableBook.id}/reviews`, { rating: 5, body: 'A genuinely fine copy.' });
  t('review created', r.status === 201 && r.data.id, JSON.stringify(r.data));
  const reviewId = r.data.id;
  r = await api('POST', `/api/books/${availableBook.id}/reviews`, { rating: 4, body: 'Second attempt, should conflict.' });
  t('duplicate review → 409', r.status === 409);
  r = await api('PUT', `/api/reviews/${reviewId}`, { rating: 4, body: 'A genuinely fine copy, on reflection.' });
  t('own review updated', r.status === 200 && r.data.body.includes('reflection'));
  r = await api('GET', `/api/books/${availableBook.id}/reviews`);
  t('review listed', r.status === 200 && r.data.total >= 1);
  r = await api('GET', `/api/books/${availableBook.id}`);
  t('book rating reflects review', r.data.review_count >= 1 && r.data.rating >= 1);

  // 8 — cancel + sign out
  const bookC = (await api('GET', '/api/books?limit=100&offset=96')).data.books.find((b) => b.available);
  cookie = '';
  await api('POST', '/api/auth/login', { email: 'test.one@example.com', password: 'test-password-1' });
  await api('POST', `/api/books/${bookC.id}/reserve`);
  cookie = '';
  await api('POST', '/api/auth/login', { email: 'test.two@example.com', password: 'test-password-2' });
  r = await api('POST', `/api/books/${bookC.id}/reserve`);
  const cancelId = r.data.id;
  r = await api('DELETE', `/api/reservations/${cancelId}`);
  t('queued cancel → 204', r.status === 204);
  cookie = '';
  await api('POST', '/api/auth/login', { email: 'test.one@example.com', password: 'test-password-1' });
  r = await api('GET', `/api/books/${bookC.id}`);
  t('holder unaffected by cancel', r.data.mine && r.data.mine.status === 'active');
  r = await api('POST', '/api/auth/logout');
  t('logout → 204', r.status === 204);
  r = await api('GET', '/api/me');
  t('session cleared', r.status === 401);
} finally {
  child.kill();
  try {
    unlinkSync(dbPath);
  } catch {}
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} ${passed}/${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
