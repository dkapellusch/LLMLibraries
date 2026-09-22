import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  year INTEGER NOT NULL,
  description TEXT NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  shelf TEXT NOT NULL,
  edition TEXT NOT NULL,
  "condition" TEXT NOT NULL,
  cover TEXT
);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('active','queued','returned','cancelled')),
  placed_at TEXT NOT NULL,
  due_at TEXT,
  renewals INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (book_id, user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_location ON books(location_id);
CREATE INDEX IF NOT EXISTS idx_reservations_book ON reservations(book_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_book ON reservations(book_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_book ON reviews(book_id);
`;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}$${scryptSync(password, salt, 32, { N: 16384 }).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split('$');
  const test = scryptSync(password, salt, 32, { N: 16384 }).toString('hex');
  return hash.length === test.length && timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

export function open(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  if (db.prepare('SELECT COUNT(*) AS n FROM books').get().n === 0) seed(db);
  return db;
}

// --- Seed data -----------------------------------------------------------------

const LOCATIONS = [
  { name: 'The Main Reading Room', address: '12 Abbey Court' },
  { name: 'The East Gallery', address: '4 Founders’ Lane' },
  { name: 'The Vault', address: 'Beneath the Old Foundry' },
];

const MEMBERS = [
  { name: 'Elena Vasquez', email: 'elena@atelier.lib' },
  { name: 'June Okafor', email: 'june@atelier.lib' },
  { name: 'Harlan Reyes', email: 'harlan@atelier.lib' },
  { name: 'Iris Chen', email: 'iris@atelier.lib' },
  { name: 'Tomas Lindqvist', email: 'tomas@atelier.lib' },
  { name: 'Priya Anand', email: 'priya@atelier.lib' },
];

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHELVES = {
  1: (n) => `${'ABCDEFGH'[Math.floor(n / 48) % 8]}-${String((n % 48) + 1).padStart(2, '0')}`,
  2: (n) => `${(n % 3) + 1}.${String((n % 72) + 1).padStart(2, '0')}`,
  3: (n) => `V-${String((n % 96) + 1).padStart(2, '0')}`,
};

const EDITIONS = ['First edition', 'Second edition', 'Third edition', 'Fifth issue', 'Second issue, revised', 'Limited issue of 150 copies'];
const CONDITIONS = ['Fine', 'Very Good', 'Very Good', 'Good', 'Good', 'Very Fair'];

const REVIEW_LINES = [
  'A quietly magnificent object; the binding alone justifies its place in the collection.',
  'Read it slowly, in the light of the afternoon reading room.',
  'Denser than it looks — keep a pencil nearby.',
  'The footnotes are a private pleasure of their own.',
  'A fine specimen, and better than the catalogue promises.',
  'Scholarly without being dusty.',
  'I went in for the plates and stayed for the prose.',
  'The margins hold a century of quiet argument.',
  'Uneven, but the finest parts are truly fine.',
  'The kind of book that changes what you expect a book to be.',
  'A small book with a large shadow.',
  'The paper alone is worth the visit.',
  'Readable on a train, worth rereading in the vault.',
  'A masterwork of its modest kind.',
  'Its calm is its power.',
];

function seed(db) {
  const seedFile = join('data', 'seed.json');
  if (!existsSync(seedFile)) throw new Error('data/seed.json is missing — run `npm run fetch` once to build the seed catalog, then start the server.');
  const books = JSON.parse(readFileSync(seedFile, 'utf8'));
  const rnd = mulberry32(0xa1b2);
  const now = new Date();
  const iso = (d) => d.toISOString();

  db.exec('BEGIN');
  try {
    const insLoc = db.prepare('INSERT INTO locations (id, name, address) VALUES (?, ?, ?)');
    LOCATIONS.forEach((l, i) => insLoc.run(i + 1, l.name, l.address));

    const insUser = db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)');
    const hash = hashPassword('rare-books');
    const joined = iso(new Date(now.getTime() - 400 * 86400000));
    for (const m of MEMBERS) insUser.run(m.name, m.email, hash, joined);

    const insBook = db.prepare(
      'INSERT INTO books (title, author, year, description, location_id, shelf, edition, "condition", cover) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    books.forEach((b, i) => {
      const loc = (i % 3) + 1;
      insBook.run(
        b.title, b.author, b.year, b.description, loc,
        SHELVES[loc](Math.floor(i / 3)),
        EDITIONS[Math.floor(rnd() * EDITIONS.length)],
        CONDITIONS[Math.floor(rnd() * CONDITIONS.length)],
        b.cover ? String(b.cover) : null
      );
    });

    // ~1,600 member reviews over ~1,100 of the most handled volumes.
    const insReview = db.prepare('INSERT INTO reviews (book_id, user_id, rating, body, created_at) VALUES (?, ?, ?, ?, ?)');
    let reviews = 0;
    for (let i = 0; i < books.length && reviews < 1600; i++) {
      if (rnd() > 0.2) continue;
      const count = 1 + (rnd() < 0.35 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0);
      const users = new Set();
      while (users.size < count) users.add(1 + Math.floor(rnd() * 6));
      for (const user of users) {
        const rating = rnd() < 0.12 ? 3 : rnd() < 0.55 ? 4 : 5;
        const line = REVIEW_LINES[Math.floor(rnd() * REVIEW_LINES.length)];
        insReview.run(i + 1, user, rating, line, iso(new Date(now.getTime() - rnd() * 700 * 86400000)));
        reviews++;
      }
    }

    // A little life already on the shelves.
    const insRes = db.prepare('INSERT INTO reservations (book_id, user_id, status, placed_at, due_at) VALUES (?, ?, ?, ?, ?)');
    const daysAgo = (n) => iso(new Date(now.getTime() - n * 86400000));
    const daysAhead = (n) => iso(new Date(now.getTime() + n * 86400000));
    if (books.length >= 11) {
      insRes.run(3, 1, 'active', daysAgo(12), daysAhead(9));
      insRes.run(11, 2, 'active', daysAgo(5), daysAhead(16));
      insRes.run(6, 1, 'queued', daysAgo(2), null);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
