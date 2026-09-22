import type Database from 'better-sqlite3'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'librarian')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  catalog_code TEXT NOT NULL UNIQUE,
  isbn TEXT UNIQUE,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT NOT NULL,
  genre TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'English',
  publication_year INTEGER NOT NULL,
  pages INTEGER,
  cover_id INTEGER,
  source_url TEXT,
  location_id TEXT NOT NULL REFERENCES locations(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS books_title_idx ON books(title);
CREATE INDEX IF NOT EXISTS books_author_idx ON books(author);
CREATE INDEX IF NOT EXISTS books_genre_idx ON books(genre);
CREATE INDEX IF NOT EXISTS books_location_idx ON books(location_id);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pickup_location_id TEXT REFERENCES locations(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'fulfilled')),
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  fulfilled_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS reservations_active_member_book_idx
  ON reservations(book_id, user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS reservations_user_idx ON reservations(user_id, status);
CREATE INDEX IF NOT EXISTS reservations_book_idx ON reservations(book_id, status);

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_out_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  returned_at TEXT,
  renewal_count INTEGER NOT NULL DEFAULT 0,
  max_renewals INTEGER NOT NULL DEFAULT 2
    CHECK (renewal_count >= 0 AND renewal_count <= max_renewals)
);

CREATE UNIQUE INDEX IF NOT EXISTS loans_active_book_idx
  ON loans(book_id) WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS loans_user_idx ON loans(user_id, returned_at);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(book_id, user_id)
);

CREATE INDEX IF NOT EXISTS reviews_book_idx ON reviews(book_id, created_at DESC);
`

export function initializeSchema(db: Database.Database): void {
  db.exec(SCHEMA)
}
