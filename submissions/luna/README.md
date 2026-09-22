# Library Luna

Library Luna is a private-library catalog and member workspace backed by SQLite. It includes real Open Library records, session-based login, full-catalog search, reading-room availability, reservations, loans, renewals, and member reviews.

## Run it

```bash
npm install
npm run seed
npm run dev
```

For a production-style local run:

```bash
npm run build
npm start
```

The app opens at `http://localhost:5173` in dev mode or `http://localhost:3000` after a build. SQLite lives at `data/library.sqlite` and can be pointed elsewhere with `LIBRARY_DB_PATH`.

Demo member: `alex@lunalibrary.test` / `luna-demo`

Demo librarian: `julian@lunalibrary.test` / `luna-curator`

## Catalog data

`server/catalog-source.json` is a checked-in snapshot of 6,088 real Open Library work records. The seed imports 5,184 of them, preserves title, author, publication year, ISBN, subjects, page count, language, cover ID, and a source URL, then distributes the books across four reading rooms. To refresh the snapshot, run `npx tsx scripts/fetch-open-library.ts` and reseed.

## Checks

```bash
npm test
npm run build
```
