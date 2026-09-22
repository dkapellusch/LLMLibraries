# Sol Library

A quiet, full-stack catalogue for a private collection of rare and remarkable books. Sol Library runs on Node’s built-in HTTP server and SQLite driver, so there are no packages to install and no external services to configure.

## Run it

Requires Node 22.5 or newer.

```bash
npm run seed
npm start
```

Open [http://localhost:4173](http://localhost:4173). The database is created at `data/library.db` on first run.

Demo member:

- Email: `reader@asterhouse.test`
- Password: `quietbooks`

You can also create a new membership from the sign-in dialog.

## What is included

- 5,400 searchable titles and 6,000 physical volumes across four library houses
- Registration and secure, salted-password login with HTTP-only sessions
- Search and filters for title, author, subject, and location
- Per-copy holdings and live availability
- Borrowing, wait queues, automatic queue fulfillment, returns, and one-time renewals
- Member dashboard with active loans, requests, and return history
- Book descriptions, star ratings, and member reviews
- Responsive, keyboard-friendly interface with reduced-motion support
- SQLite constraints and transactions around circulation state

## Commands

```bash
npm start       # run the server on port 4173
npm run dev     # restart the server as files change
npm run seed    # create or complete the deterministic catalogue
npm test        # run database and HTTP integration tests
npm run check   # syntax-check every layer, then run the tests
```

Set `PORT` to change the port or `SOL_DB_PATH` to use a different SQLite file.

## Structure

```text
public/         browser application and visual system
scripts/seed.js explicit seed command
src/db.js       schema, seed data, and circulation rules
server.js       HTTP server, JSON API, and static file delivery
test/           database and end-to-end API tests
```

No generated database is committed. The same deterministic seed runs automatically at server startup, making a clean clone immediately usable.
