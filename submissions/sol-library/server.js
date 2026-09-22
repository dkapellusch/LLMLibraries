import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, seedDatabase, verifyPassword, hashPassword, bookAvailabilitySql, borrowOrQueue, returnLoan } from './src/db.js';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

async function body(req) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    parts.push(chunk);
  }
  if (!parts.length) return {};
  try { return JSON.parse(Buffer.concat(parts).toString()); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

function cookie(req, name) {
  const item = (req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function currentMember(db, req) {
  const token = cookie(req, 'sol_session');
  if (!token) return null;
  return db.prepare(`SELECT m.id,m.name,m.email,m.joined_at FROM sessions s JOIN members m ON m.id=s.member_id
    WHERE s.token=? AND s.expires_at > CURRENT_TIMESTAMP`).get(token) || null;
}

function requireMember(db, req) {
  const member = currentMember(db, req);
  if (!member) throw Object.assign(new Error('Please sign in to continue.'), { status: 401 });
  return member;
}

function routeId(path, pattern) {
  const match = path.match(pattern);
  return match ? Number(match[1]) : null;
}

function bookList(db, url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const location = Number(url.searchParams.get('location')) || 0;
  const subject = (url.searchParams.get('subject') || '').trim().slice(0, 40);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = 24;
  const where = [];
  const params = [];
  if (q) {
    where.push('(b.title LIKE ? OR b.author LIKE ? OR b.subjects LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (location) {
    where.push('EXISTS (SELECT 1 FROM copies cx WHERE cx.book_id=b.id AND cx.location_id=?)');
    params.push(location);
  }
  if (subject) {
    where.push('b.subjects LIKE ?');
    params.push(`%${subject}%`);
  }
  const filter = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT count(*) AS n FROM books b${filter}`).get(...params).n;
  const books = db.prepare(`${bookAvailabilitySql()}${filter} GROUP BY b.id
    ORDER BY CASE WHEN available_count > 0 THEN 0 ELSE 1 END, b.title COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  return { books, page, pages: Math.ceil(total / limit), total };
}

function bookDetail(db, id, memberId) {
  const book = db.prepare(`${bookAvailabilitySql()} WHERE b.id=? GROUP BY b.id`).get(id);
  if (!book) throw Object.assign(new Error('Book not found.'), { status: 404 });
  book.subjects = book.subjects.split(',');
  book.holdings = db.prepare(`SELECT l.id, l.name, l.address, c.shelf,
    CASE WHEN ln.id IS NULL THEN 1 ELSE 0 END AS available
    FROM copies c JOIN locations l ON l.id=c.location_id
    LEFT JOIN loans ln ON ln.copy_id=c.id AND ln.returned_at IS NULL WHERE c.book_id=? ORDER BY l.name,c.id`).all(id);
  book.reviews = db.prepare(`SELECT rv.id,rv.rating,rv.body,rv.created_at,m.name AS member_name,
    CASE WHEN rv.member_id=? THEN 1 ELSE 0 END AS own
    FROM reviews rv JOIN members m ON m.id=rv.member_id WHERE rv.book_id=? ORDER BY rv.created_at DESC`).all(memberId || -1, id);
  if (memberId) {
    book.relationship = db.prepare(`SELECT
      (SELECT l.id FROM loans l JOIN copies c ON c.id=l.copy_id WHERE l.member_id=? AND c.book_id=? AND l.returned_at IS NULL) AS loan_id,
      (SELECT r.id FROM reservations r WHERE r.member_id=? AND r.book_id=? AND r.status='waiting') AS reservation_id`).get(memberId, id, memberId, id);
  }
  return book;
}

function account(db, memberId) {
  const loans = db.prepare(`SELECT l.id,l.borrowed_at,l.due_at,l.renewals,b.id AS book_id,b.title,b.author,b.accent,
    loc.name AS location, c.shelf,
    (SELECT count(*) FROM reservations r WHERE r.book_id=b.id AND r.status='waiting') AS queue_count
    FROM loans l JOIN copies c ON c.id=l.copy_id JOIN books b ON b.id=c.book_id JOIN locations loc ON loc.id=c.location_id
    WHERE l.member_id=? AND l.returned_at IS NULL ORDER BY l.due_at`).all(memberId);
  const reservations = db.prepare(`SELECT r.id,r.created_at,b.id AS book_id,b.title,b.author,b.accent,
    (SELECT count(*) FROM reservations r2 WHERE r2.book_id=r.book_id AND r2.status='waiting' AND (r2.created_at < r.created_at OR (r2.created_at=r.created_at AND r2.id<=r.id))) AS position
    FROM reservations r JOIN books b ON b.id=r.book_id WHERE r.member_id=? AND r.status='waiting' ORDER BY r.created_at`).all(memberId);
  const history = db.prepare(`SELECT l.id,l.borrowed_at,l.returned_at,b.id AS book_id,b.title,b.author
    FROM loans l JOIN copies c ON c.id=l.copy_id JOIN books b ON b.id=c.book_id
    WHERE l.member_id=? AND l.returned_at IS NOT NULL ORDER BY l.returned_at DESC LIMIT 12`).all(memberId);
  return { loans, reservations, history };
}

export function createApp({ db = openDatabase() } = {}) {
  seedDatabase(db);
  const handler = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const member = currentMember(db, req);

        if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
          const locations = db.prepare(`SELECT l.*,count(DISTINCT c.book_id) AS title_count FROM locations l
            LEFT JOIN copies c ON c.location_id=l.id GROUP BY l.id ORDER BY l.id`).all();
          const stats = db.prepare(`SELECT (SELECT count(*) FROM books) AS titles,
            (SELECT count(*) FROM copies) AS volumes, (SELECT count(*) FROM members) AS members`).get();
          return json(res, 200, { member, locations, stats, subjects: [...new Set(['Literature','Natural History','Travel','Philosophy','Art','Poetry','Design','History'])] });
        }
        if (req.method === 'GET' && url.pathname === '/api/books') return json(res, 200, bookList(db, url));
        const detailId = routeId(url.pathname, /^\/api\/books\/(\d+)$/);
        if (req.method === 'GET' && detailId) return json(res, 200, bookDetail(db, detailId, member?.id));

        if (req.method === 'POST' && url.pathname === '/api/register') {
          const input = await body(req);
          const name = String(input.name || '').trim().slice(0, 80);
          const email = String(input.email || '').trim().toLowerCase().slice(0, 160);
          const password = String(input.password || '');
          if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
            throw Object.assign(new Error('Use your full name, a valid email, and at least 8 password characters.'), { status: 400 });
          }
          let result;
          try { result = db.prepare('INSERT INTO members(name,email,password_hash) VALUES(?,?,?)').run(name, email, hashPassword(password)); }
          catch (error) {
            if (String(error.message).includes('UNIQUE')) throw Object.assign(new Error('That email is already registered.'), { status: 409 });
            throw error;
          }
          const token = randomBytes(32).toString('hex');
          const expires = new Date(Date.now() + 30 * 86400000).toISOString();
          db.prepare('INSERT INTO sessions(token,member_id,expires_at) VALUES(?,?,?)').run(token, result.lastInsertRowid, expires);
          return json(res, 201, { member: { id: Number(result.lastInsertRowid), name, email } }, { 'set-cookie': `sol_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000` });
        }
        if (req.method === 'POST' && url.pathname === '/api/login') {
          const input = await body(req);
          const found = db.prepare('SELECT * FROM members WHERE email=?').get(String(input.email || '').trim().toLowerCase());
          if (!found || !verifyPassword(String(input.password || ''), found.password_hash)) {
            throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 });
          }
          const token = randomBytes(32).toString('hex');
          db.prepare('INSERT INTO sessions(token,member_id,expires_at) VALUES(?,?,?)').run(token, found.id, new Date(Date.now() + 30 * 86400000).toISOString());
          return json(res, 200, { member: { id: found.id, name: found.name, email: found.email, joined_at: found.joined_at } }, { 'set-cookie': `sol_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000` });
        }
        if (req.method === 'POST' && url.pathname === '/api/logout') {
          const token = cookie(req, 'sol_session');
          if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
          return json(res, 200, { ok: true }, { 'set-cookie': 'sol_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
        }
        if (req.method === 'GET' && url.pathname === '/api/account') {
          const user = requireMember(db, req);
          return json(res, 200, account(db, user.id));
        }
        const reserveId = routeId(url.pathname, /^\/api\/books\/(\d+)\/reserve$/);
        if (req.method === 'POST' && reserveId) {
          const user = requireMember(db, req);
          const input = await body(req);
          if (!db.prepare('SELECT id FROM books WHERE id=?').get(reserveId)) throw Object.assign(new Error('Book not found.'), { status: 404 });
          return json(res, 201, borrowOrQueue(db, user.id, reserveId, Number(input.locationId) || null));
        }
        const reviewId = routeId(url.pathname, /^\/api\/books\/(\d+)\/reviews$/);
        if (req.method === 'POST' && reviewId) {
          const user = requireMember(db, req);
          const input = await body(req);
          const rating = Number(input.rating);
          const reviewBody = String(input.body || '').trim();
          if (!Number.isInteger(rating) || rating < 1 || rating > 5 || reviewBody.length < 8 || reviewBody.length > 1200) {
            throw Object.assign(new Error('Choose a rating and write at least 8 characters.'), { status: 400 });
          }
          db.prepare(`INSERT INTO reviews(book_id,member_id,rating,body) VALUES(?,?,?,?)
            ON CONFLICT(book_id,member_id) DO UPDATE SET rating=excluded.rating,body=excluded.body,created_at=CURRENT_TIMESTAMP`)
            .run(reviewId, user.id, rating, reviewBody);
          return json(res, 201, { ok: true });
        }
        const renewId = routeId(url.pathname, /^\/api\/loans\/(\d+)\/renew$/);
        if (req.method === 'POST' && renewId) {
          const user = requireMember(db, req);
          const loan = db.prepare(`SELECT l.*,c.book_id FROM loans l JOIN copies c ON c.id=l.copy_id WHERE l.id=? AND l.member_id=? AND l.returned_at IS NULL`).get(renewId, user.id);
          if (!loan) throw Object.assign(new Error('Active loan not found.'), { status: 404 });
          if (loan.renewals >= 1) throw Object.assign(new Error('This loan has already been renewed.'), { status: 409 });
          const waiting = db.prepare("SELECT id FROM reservations WHERE book_id=? AND status='waiting' LIMIT 1").get(loan.book_id);
          if (waiting) throw Object.assign(new Error('This title is requested by another member and cannot be renewed.'), { status: 409 });
          const due = new Date(new Date(loan.due_at).getTime() + 14 * 86400000).toISOString();
          db.prepare('UPDATE loans SET due_at=?,renewals=renewals+1 WHERE id=?').run(due, renewId);
          return json(res, 200, { dueAt: due });
        }
        const returnId = routeId(url.pathname, /^\/api\/loans\/(\d+)\/return$/);
        if (req.method === 'POST' && returnId) {
          const user = requireMember(db, req);
          return json(res, 200, returnLoan(db, user.id, returnId));
        }
        const cancelId = routeId(url.pathname, /^\/api\/reservations\/(\d+)$/);
        if (req.method === 'DELETE' && cancelId) {
          const user = requireMember(db, req);
          const result = db.prepare("UPDATE reservations SET status='cancelled' WHERE id=? AND member_id=? AND status='waiting'").run(cancelId, user.id);
          if (!result.changes) throw Object.assign(new Error('Active reservation not found.'), { status: 404 });
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'Endpoint not found.' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
      const requested = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
      const path = join(publicDir, requested);
      if (!path.startsWith(publicDir)) return json(res, 404, { error: 'Not found.' });
      try {
        const content = await readFile(path);
        res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream', 'cache-control': 'no-cache' });
        if (req.method === 'HEAD') res.end(); else res.end(content);
      } catch {
        const content = await readFile(join(publicDir, 'index.html'));
        res.writeHead(200, { 'content-type': mime['.html'], 'cache-control': 'no-cache' });
        res.end(content);
      }
    } catch (error) {
      const status = Number(error.status) || 500;
      if (status === 500) console.error(error);
      json(res, status, { error: status === 500 ? 'Something went wrong.' : error.message });
    }
  };
  return { handler, db };
}

export function startServer(options = {}) {
  const app = createApp(options);
  const server = createServer(app.handler);
  return { ...app, server };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4173;
  const { server } = startServer();
  server.listen(port, () => console.log(`Sol Library is open at http://localhost:${port}`));
}
