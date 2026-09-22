# Aldbury — Private Library (build contract)

A full-stack app for a private library of rare books. Zero build step, minimal code.

## Stack

- Node.js (ESM), SQLite via built-in `node:sqlite` if available (Node ≥ 22.5); otherwise Bun.
- **Zero npm dependencies.** Password hashing: `crypto.scrypt`. Sessions: DB table + httpOnly cookie.
- Frontend: one HTML file, one CSS file, one JS file (vanilla SPA, hash routing). No frameworks.
## Files (ownership)

| File | Owner | Purpose |
|---|---|---|
| `package.json` | backend | `type: module`, scripts: `start`, `seed`, `test` |
| `db.js` | backend | schema, `open(path)`, `seed(db)` — deterministic, idempotent |
| `server.js` | backend | HTTP server, REST API, static serving, auth middleware |
| `test.js` | backend | end-to-end smoke test over HTTP (fetch + cookie jar) |
| `public/index.html` | frontend | single page shell |
| `public/styles.css` | frontend | all styling (design tokens below) |
| `public/app.js` | frontend | SPA: state, router, views, api client |
| `README.md`, `.gitignore` | main | run instructions + demo accounts |
| `package.json` | backend | `type: module`, scripts: `start`, `test` (server auto-seeds an empty DB; no separate seed script) |
## Schema (SQLite)

```sql
users(id INTEGER PK, name TEXT, email TEXT UNIQUE COLLATE NOCASE, password_hash TEXT, created_at TEXT)
locations(id INTEGER PK, name TEXT, address TEXT)
books(id INTEGER PK, title TEXT, author TEXT, year INTEGER, description TEXT,
      location_id INT REFERENCES locations(id), shelf TEXT, edition TEXT, condition TEXT)
reservations(id INTEGER PK, book_id INT, user_id INT,
             status TEXT CHECK (status IN ('active','queued','returned','cancelled')),
             placed_at TEXT, due_at TEXT, renewals INTEGER NOT NULL DEFAULT 0)
reviews(id INTEGER PK, book_id INT, user_id INT, rating INT CHECK (rating BETWEEN 1 AND 5),
        body TEXT, created_at TEXT, UNIQUE (book_id, user_id))
sessions(token TEXT PK, user_id INT, created_at TEXT, expires_at TEXT)
```

- `password_hash` stored as `salt_hex$hash_hex` (scrypt, N=16384).
- All timestamps ISO-8601 UTC strings.
- Indexes: `reservations(book_id)`, `reservations(user_id)`, `reviews(book_id)`, `books(location_id)`.

## Locations (seeded, exactly 3)

1. `The Main Reading Room` — 12 Abbey Court
2. `The East Gallery` — 4 Founders' Lane
3. `The Vault` — Beneath the Old Foundry

## Domain rules

- Loan period **21 days** from activation. Due date = `placed_at + 21d` when a reservation becomes `active`.
- **Renew**: `due_at += 21d`, `renewals += 1`, max **3** renewals, then 409.
- **Availability**: a book is available iff it has no `active` reservation.
- **Queue**: reserving an unavailable book creates `queued`. On `return`/`cancel` of the active one, the oldest `queued` promotes to `active` with a fresh 21-day due date.
- One open reservation per (user, book) — 409 on duplicate.
- Reviews: 1 per (user, book); `PUT /api/reviews/:id` edits own review. Rating 1–5, body ≤ 2000 chars.

## API (JSON, `application/json`)

Auth via cookie `session=<token>` (HttpOnly, SameSite=Lax, Path=/). Unauthenticated on protected routes → 401.

| Method & path | Auth | Behavior |
|---|---|---|
| `POST /api/auth/register` `{name,email,password}` | – | validate (name≥2, email shape, password≥8); 201 + cookie; 409 if email exists |
| `POST /api/auth/login` `{email,password}` | – | 200 + cookie `{name,email}`; 401 bad credentials |
| `POST /api/auth/logout` | ✔ | 204, destroys session, clears cookie |
| `GET /api/me` | ✔ | `{name,email,joined}` |
| `GET /api/locations` | – | `[{id,name,address}]` |
| `GET /api/books?limit&offset&q&location&order` | – | search + list; default `order=recent` (newest first), `title`, `author`, `year` (desc). `q` matches title/author/description (case-insensitive LIKE, escaped `%`/`_`). Response `{total, books:[BookSummary]}` |
| `GET /api/books/:id` | – | full book + `available`, `queue`, `mine` (caller's reservation or null) |
| `POST /api/books/:id/reserve` | ✔ | 201 `{id,status,due_at?,position?}` — 409 if already reserved |
| `GET /api/reservations?status=` | ✔ | own reservations, newest first; `status` optional filter |
| `POST /api/reservations/:id/renew` | ✔ | 200 `{due_at,renewals}`; 409 if >3 or not active/own |
| `POST /api/reservations/:id/return` | ✔ | own; promotes next queued; 200 |
| `DELETE /api/reservations/:id` | ✔ | cancel queued or own active; 204 |
| `GET /api/books/:id/reviews?limit&offset` | – | `{total, rows:[{id,name,rating,body,created_at}]}` newest first |
| `POST /api/books/:id/reviews` `{rating,body}` | ✔ | 201; 409 if user already reviewed |
| `PUT /api/reviews/:id` `{rating,body}` | ✔ | own only; 200 |

`BookSummary`: `{id,title,author,year,description,location:{id,name},shelf,edition,condition,rating,review_count,available}`
`rating` = avg (nullable), `review_count` int.

Errors: `{"error":"message"}` with proper 4xx/500. Unknown API route → 404 JSON.

## Seed data (deterministic, PRNG seed `0xA1B2`)

- **5,400 books**: generated from rich word pools (40+ title patterns, 60 first names, 80 last names, 30+ description sentence templates, cities London/Amsterdam/Paris/Geneva/Oxford/Venice/Leipzig/Edinburgh/Boston). Years 1500–1930, weighted to 1750–1900. Editions: first/second/fifth issue, "Limited issue of N copies". Conditions: Fine / Very Good / Good / Very Fair. Shelves: Main `A-01`…`H-48`, East `1.01`…`3.24`, Vault `V-01`…`V-96`. Descriptions: 2–3 sentences, cataloguer's voice ("A fine specimen, bound in period calf with gilt spine lettering."). Titles must be unique (dedupe by title+author).
- **6 demo patrons** (password for all: `rare-books`):
  - `elena@atelier.lib` — Elena Vasquez
  - `june@atelier.lib` — June Okafor
  - `harlan@atelier.lib` — Harlan Reyes
  - `iris@atelier.lib` — Iris Chen
  - `tomás@atelier.lib` — Tomás Lindqvist
  - `priya@atelier.lib` — Priya Anand
- **~1,800 reviews** spread over ~1,200 books, ratings weighted 4–5, 1–3 sentence bodies from a pool.
- A handful of seeded reservations so "My reservations" isn't empty for the first login (elena: 1 active, 1 queued).

`seed(db)` runs only when `books` table is empty. Never wipes.

## Design (Linear-inspired, dark)

Tokens:
- `--bg #0f1011`, `--panel #17181b`, `--raised #1e2024`, `--border #26282d`, `--border-soft #1f2126`
- `--text #ededf0`, `--text-2 #9ba1ab`, `--text-3 #6b7280`
- `--accent #d8b56a` (parchment gold), `--accent-hover #e2c383`, `--danger #e07a6a`, `--ok #7fc7a4`
- radius: 8px controls / 12px cards; hairline 1px borders; subtle shadow only for floating panels
- font: Inter (Google Fonts) → fallback `-apple-system, "Segoe UI", system-ui, sans-serif`; base **15.5px**, line-height 1.55; headings -0.01em tracking
- focus: 2px accent ring. Motion: 120ms ease-out on hover/press. No animation noise.

Wordmark: **Aldbury** (small caps "PRIVATE LIBRARY" beneath).

Routes (hash):
- `#/login` — centered card: Login / Register toggle, fields, error line, "Demo accounts" hint box listing `elena@atelier.lib` / `june@atelier.lib` (password `rare-books`).
- `#/` — browse: header (wordmark left, user chip right with sign out); centered command-bar-style search (large input, ⌘/ shortcut focuses it); location segmented filter (All + 3); result count; responsive book grid: CSS-generated cover (deterministic hue from title, serif monogram), title 16px/600, author · year, location · shelf line, ★ rating (n), availability dot (ok/danger).
- `#/book/:id` — back link; 2 columns: left = title block, description, spec list (Author, Year, Edition, Condition, Location, Shelf); right = sticky card: availability, Reserve / Already reserved state, Renew w/ remaining count, Cancel, then reviews (newest first) + review form (1–5 stars input, textarea).
- `#/reservations` — sections: Active (due date, red if overdue, Renew "n left", Cancel), Queued (position, Cancel), Returned (collapsible history). Empty states per section.
- Toasts bottom-right (dark raised card, 3s auto-dismiss). 401 anywhere → `#/login`. 404 → "Not found" panel.
- No tiny text: nothing below 13px except meta. No emoji in UI. No gradients, no glassmorphism.

## Test contract (`npm test`)

`test.js` spins up the real server on a free port with a temp DB, then over HTTP:
1. register + login + wrong-password 401
2. locations, books list (total ≥ 5000), search by title word, search by author, location filter
3. book detail: rating/review_count present
4. reserve available → active + due_at; duplicate → 409
5. renew → due_at advances, renewals=1; renew past 3 → 409
6. second user queues → position 1; first user returns → second promoted active
7. review create → 409 duplicate; PUT edits own
8. cancel queued; me endpoint; logout clears session (subsequent /me 401)
Prints `PASS n/n` or failing assertion; exit code 0/1.

## Non-goals

No admin UI, no fines, no email, no i18n, no CSS framework, no build step, no npm deps.
