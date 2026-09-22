import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { open, hashPassword, verifyPassword } from './db.js';

const DAY = 86400000;
const LOAN_DAYS = 21;
const MAX_RENEWALS = 3;
const SESSION_DAYS = 30;

const db = open(process.env.DB_PATH || 'data/library.db');
const PORT = Number(process.env.PORT) || 4000;
const PUBLIC = resolve('public');
const nowIso = () => new Date().toISOString();
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());

// --- helpers ---------------------------------------------------------------

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}
const fail = (res, code, message) => json(res, code, { error: message });

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100_000) {
        reject(new Error('body too large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolveBody({});
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sessionToken(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)session=([^;]+)/);
  return m ? m[1] : null;
}

function userFrom(req) {
  const token = sessionToken(req);
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.name, u.email, u.created_at AS joined
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`
      )
      .get(token, nowIso()) || null
  );
}

function requireUser(req, res) {
  const user = userFrom(req);
  if (!user) {
    fail(res, 401, 'Sign in is required');
    return null;
  }
  return user;
}

function startSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token, userId, nowIso(), inDays(SESSION_DAYS)
  );
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('set-cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=${SESSION_DAYS * 86400}`);
}

function endSession(req) {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// --- auth rate limiting (per IP) ---------------------------------------------
const AUTH_LIMIT = Number(process.env.AUTH_LIMIT || 6);
const AUTH_WINDOW_MS = 60_000;
const authHits = new Map();
function authAllowed(ip) {
  const now = Date.now();
  const hits = (authHits.get(ip) || []).filter((t) => now - t < AUTH_WINDOW_MS);
  if (hits.length >= AUTH_LIMIT) {
    authHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  authHits.set(ip, hits);
  return true;
}

const DUMMY_HASH = hashPassword('timing-dummy');

// --- catalog queries ---------------------------------------------------------

function bookRow(id) {
  return (
    db
      .prepare(
        `SELECT b.*, l.name AS location_name, rv.rating, rv.review_count,
                (SELECT 1 FROM reservations r WHERE r.book_id = b.id AND r.status = 'active') AS has_active
         FROM books b
         JOIN locations l ON l.id = b.location_id
         LEFT JOIN (SELECT book_id, AVG(rating) AS rating, COUNT(*) AS review_count FROM reviews GROUP BY book_id) rv ON rv.book_id = b.id
         WHERE b.id = ?`
      )
      .get(id) || null
  );
}

function coverURL(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://covers.openlibrary.org/b/id/${s}-L.jpg`;
}

function summary(r) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    year: r.year,
    description: r.description,
    location: { id: r.location_id, name: r.location_name },
    shelf: r.shelf,
    edition: r.edition,
    condition: r.condition,
    cover: coverURL(r.cover),
    rating: r.rating == null ? null : Math.round(r.rating * 10) / 10,
    review_count: Number(r.review_count),
    available: !r.has_active,
  };
}

function listBooks({ q, location, order, limit, offset }) {
  const where = [];
  const args = [];
  if (q) {
    const e = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push(`(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`);
    args.push(`%${e}%`, `%${e}%`, `%${e}%`);
  }
  if (location) {
    where.push('location_id = ?');
    args.push(location);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql =
    { recent: 'b.id DESC', title: 'b.title COLLATE NOCASE ASC', author: 'b.author COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC', year: 'b.year DESC, b.title COLLATE NOCASE ASC' }[order] ||
    'b.id DESC';
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM books b ${whereSql}`).get(...args).n);
  const rows = db
    .prepare(
      `SELECT b.*, l.name AS location_name, rv.rating, rv.review_count,
              (SELECT 1 FROM reservations r WHERE r.book_id = b.id AND r.status = 'active') AS has_active
       FROM books b
       JOIN locations l ON l.id = b.location_id
       LEFT JOIN (SELECT book_id, AVG(rating) AS rating, COUNT(*) AS review_count FROM reviews GROUP BY book_id) rv ON rv.book_id = b.id
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset);
  return { total, books: rows.map(summary) };
}

function promoteNext(bookId) {
  db.prepare(
    `UPDATE reservations SET status = 'active', due_at = ?
     WHERE id = (SELECT id FROM reservations WHERE book_id = ? AND status = 'queued' ORDER BY placed_at, id LIMIT 1)`
  ).run(inDays(LOAN_DAYS), bookId);
}

function queuePosition(bookId, id) {
  return Number(
    db.prepare(`SELECT COUNT(*) AS n FROM reservations WHERE book_id = ? AND status = 'queued' AND id < ?`).get(bookId, id).n
  ) + 1;
}

// --- routes ------------------------------------------------------------------

const routes = [];
const on = (method, path, handler, auth = false) => routes.push({ method, path, handler, auth });

on('POST', '/api/auth/register', async (req, res) => {
  if (!authAllowed(req.socket.remoteAddress)) return fail(res, 429, 'Too many attempts — wait a minute and try again.');
  const { name, email, password } = await readBody(req);
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) return fail(res, 400, 'Name must be 2–80 characters');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'A valid email is required');
  if (typeof password !== 'string' || password.length < 8) return fail(res, 400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim())) return fail(res, 409, 'An account with this email already exists');
  const id = Number(db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(name.trim(), email.trim(), hashPassword(password), nowIso()).lastInsertRowid);
  startSession(res, id);
  json(res, 201, { name: name.trim(), email: email.trim() });
});

on('POST', '/api/auth/login', async (req, res) => {
  if (!authAllowed(req.socket.remoteAddress)) return fail(res, 429, 'Too many attempts — wait a minute and try again.');
  const { email, password } = await readBody(req);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(typeof email === 'string' ? email.trim() : '');
  const valid = typeof password === 'string' && verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid) return fail(res, 401, 'Invalid email or password');
  startSession(res, user.id);
  json(res, 200, { name: user.name, email: user.email });
});

on('POST', '/api/auth/logout', (req, res) => {
  endSession(req);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('set-cookie', `session=; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=0`);
  res.writeHead(204).end();
}, true);

on('GET', '/api/me', (req, res, _params, user) => {
  json(res, 200, { id: user.id, name: user.name, email: user.email, joined: user.joined });
}, true);

on('GET', '/api/locations', (req, res) => {
  json(res, 200, db.prepare('SELECT id, name FROM locations ORDER BY id').all());
});

on('GET', '/api/books', (req, res, _params, _user, url) => {
  const q = (url.searchParams.get('q') || '').trim();
  const location = url.searchParams.get('location');
  const order = url.searchParams.get('order') || 'recent';
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 24, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  json(res, 200, listBooks({ q, location, order, limit, offset }));
});

on('GET', '/api/books/:id', (req, res, params, user, url) => {
  const book = bookRow(Number(params.id));
  if (!book) return fail(res, 404, 'Book not found');
  const queue = Number(db.prepare(`SELECT COUNT(*) AS n FROM reservations WHERE book_id = ? AND status = 'queued'`).get(book.id).n);
  let mine = null;
  if (user) {
    const m = db
      .prepare(`SELECT id, status, placed_at, due_at, renewals FROM reservations WHERE book_id = ? AND user_id = ? AND status IN ('active','queued')`)
      .get(book.id, user.id);
    if (m) {
      mine = { id: Number(m.id), status: m.status, due_at: m.due_at, renewals: m.renewals };
      if (m.status === 'queued') mine.position = queuePosition(book.id, m.id);
    }
  }
  json(res, 200, { ...summary(book), queue, max_renewals: MAX_RENEWALS, mine });
});

on('POST', '/api/books/:id/reserve', (req, res, params, user) => {
  const book = bookRow(Number(params.id));
  if (!book) return fail(res, 404, 'Book not found');
  if (db.prepare(`SELECT id FROM reservations WHERE book_id = ? AND user_id = ? AND status IN ('active','queued')`).get(book.id, user.id))
    return fail(res, 409, 'You already have a reservation on this book');
  const due = inDays(LOAN_DAYS);
  let id;
  try {
    id = Number(db.prepare(`INSERT INTO reservations (book_id, user_id, status, placed_at, due_at) VALUES (?, ?, 'active', ?, ?)`).run(book.id, user.id, nowIso(), due).lastInsertRowid);
    return json(res, 201, { id, status: 'active', due_at: due });
  } catch {
    // Lost the race: someone took the book first — join the queue.
    id = Number(db.prepare(`INSERT INTO reservations (book_id, user_id, status, placed_at) VALUES (?, ?, 'queued', ?)`).run(book.id, user.id, nowIso()).lastInsertRowid);
    return json(res, 201, { id, status: 'queued', position: queuePosition(book.id, id) });
  }
}, true);

on('GET', '/api/reservations', (req, res, _params, user, url) => {
  const status = url.searchParams.get('status');
  const rows = db
    .prepare(
      `SELECT r.id, r.status, r.placed_at, r.due_at, r.renewals,
              b.id AS bookid, b.title, b.author, b.year, b.cover, l.name AS location, b.shelf
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       JOIN locations l ON l.id = b.location_id
       WHERE r.user_id = ? ${status ? 'AND r.status = ?' : ''}
       ORDER BY CASE r.status WHEN 'active' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, r.id DESC`
    )
    .all(...(status ? [user.id, status] : [user.id]));
  json(res, 200, rows.map((r) => ({
    id: Number(r.id),
    status: r.status,
    placed_at: r.placed_at,
    due_at: r.due_at,
    renewals: r.renewals,
    max_renewals: MAX_RENEWALS,
    position: r.status === 'queued' ? queuePosition(r.bookid, r.id) : undefined,
    book: { id: Number(r.bookid), title: r.title, author: r.author, year: r.year, cover: coverURL(r.cover), location: r.location, shelf: r.shelf },
  })));
}, true);

on('POST', '/api/reservations/:id/renew', (req, res, params, user) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?').get(Number(params.id), user.id);
  if (!r) return fail(res, 404, 'Reservation not found');
  if (r.status !== 'active') return fail(res, 409, 'Only active reservations can be renewed');
  if (r.renewals >= MAX_RENEWALS) return fail(res, 409, 'No renewals remaining');
  const due = new Date(Math.max(Date.now(), Date.parse(r.due_at)) + LOAN_DAYS * DAY).toISOString();
  db.prepare('UPDATE reservations SET due_at = ?, renewals = renewals + 1 WHERE id = ?').run(due, r.id);
  json(res, 200, { due_at: due, renewals: r.renewals + 1 });
}, true);

on('POST', '/api/reservations/:id/return', (req, res, params, user) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?').get(Number(params.id), user.id);
  if (!r) return fail(res, 404, 'Reservation not found');
  if (r.status === 'active') {
    db.prepare(`UPDATE reservations SET status = 'returned' WHERE id = ?`).run(r.id);
    promoteNext(r.book_id);
  } else if (r.status === 'queued') {
    db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`).run(r.id);
  } else {
    return fail(res, 409, 'This reservation is already closed');
  }
  json(res, 200, { ok: true });
}, true);

on('DELETE', '/api/reservations/:id', (req, res, params, user) => {
  const r = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?').get(Number(params.id), user.id);
  if (!r) return fail(res, 404, 'Reservation not found');
  if (r.status === 'active') {
    db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`).run(r.id);
    promoteNext(r.book_id);
  } else if (r.status === 'queued') {
    db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`).run(r.id);
  } else {
    return fail(res, 409, 'Nothing to cancel');
  }
  res.writeHead(204).end();
}, true);

on('GET', '/api/books/:id/reviews', (req, res, params, _user, url) => {
  const book = db.prepare('SELECT id FROM books WHERE id = ?').get(Number(params.id));
  if (!book) return fail(res, 404, 'Book not found');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE book_id = ?').get(book.id).n);
  const rows = db
    .prepare(
      `SELECT u.name, r.id, r.user_id, r.rating, r.body, r.created_at
       FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.book_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`
    )
    .all(book.id, limit, offset);
  json(res, 200, { total, rows });
});

on('POST', '/api/books/:id/reviews', async (req, res, params, user) => {
  const book = db.prepare('SELECT id FROM books WHERE id = ?').get(Number(params.id));
  if (!book) return fail(res, 404, 'Book not found');
  const { rating, body } = await readBody(req);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, 'Rating must be a whole number from 1 to 5');
  const text = typeof body === 'string' ? body.trim() : '';
  if (text.length < 3 || text.length > 2000) return fail(res, 400, 'Review text must be 3–2000 characters');
  if (db.prepare('SELECT id FROM reviews WHERE book_id = ? AND user_id = ?').get(book.id, user.id)) return fail(res, 409, 'You have already reviewed this book');
  const created = nowIso();
  const id = Number(db.prepare('INSERT INTO reviews (book_id, user_id, rating, body, created_at) VALUES (?, ?, ?, ?, ?)').run(book.id, user.id, rating, text, created).lastInsertRowid);
  json(res, 201, { id, rating, body: text, created_at: created });
}, true);

on('PUT', '/api/reviews/:id', async (req, res, params, user) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(params.id));
  if (!r) return fail(res, 404, 'Review not found');
  if (r.user_id !== user.id) return fail(res, 403, 'This review belongs to another member');
  const { rating, body } = await readBody(req);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, 'Rating must be a whole number from 1 to 5');
  if (typeof body !== 'string' || body.trim().length < 3 || body.trim().length > 2000) return fail(res, 400, 'Review text must be 3–2000 characters');
  db.prepare('UPDATE reviews SET rating = ?, body = ? WHERE id = ?').run(rating, body.trim(), r.id);
  json(res, 200, { id: Number(r.id), rating, body: body.trim() });
}, true);

// --- dispatch ----------------------------------------------------------------

function dispatch(req, res, url) {
  const segs = url.pathname.split('/').filter(Boolean);
  for (const r of routes) {
    const parts = r.path.split('/').filter(Boolean);
    if (r.method !== req.method || parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      if (parts[i].startsWith(':')) {
        try {
          params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
        } catch {
          return fail(res, 400, 'Malformed path');
        }
      } else if (parts[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const user = r.auth ? requireUser(req, res) : userFrom(req);
    if (r.auth && !user) return;
    return r.handler(req, res, params, user, url);
  }
  if (url.pathname.startsWith('/api/')) fail(res, 404, 'Not found');
  else void serveStatic(req, res, url.pathname);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = resolve(PUBLIC, rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + '/')) return fail(res, 403, 'Forbidden');
  const data = await readFile(file).catch(() => null);
  if (data) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'content-length': data.length, 'cache-control': 'no-cache' });
    res.end(data);
    return;
  }
  const index = await readFile(`${PUBLIC}/index.html`).catch(() => null);
  if (!index) return fail(res, 404, 'Not found');
  res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
  res.end(index);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  Promise.resolve(dispatch(req, res, url)).catch((e) => {
    if (!res.headersSent) {
      if (e.message === 'invalid JSON') fail(res, 400, 'Invalid JSON');
      else if (e.message === 'body too large') fail(res, 413, 'Body too large');
      else fail(res, 500, 'Server error');
    }
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use — run with PORT=<free port> instead.`);
  else console.error(`Server error: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, () => console.log(`Aldbury is ready at http://localhost:${PORT}`));
