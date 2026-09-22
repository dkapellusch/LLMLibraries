# Aldbury — Private Library

A small full-stack app for managing a private library of rare books: five thousand+ catalogued volumes across three locations, with search, reservations, renewals, and member reviews.

No frameworks, no build step, no npm dependencies — Node.js and its built-in SQLite.

## Run

```sh
npm run fetch     # one-time: build data/seed.json from Internet Archive + Wikipedia (~10–20 min, needs network)
node ol-covers.mjs   # optional: backfill cover images from Open Library into data/seed.json
node add-ia-covers.mjs  # optional: backfill cover images from Internet Archive into data/seed.json
node server.js    # http://localhost:4000
npm test          # end-to-end API tests (spawns its own server + temp DB)
```

The checked-in `data/seed.json` contains the catalog source. The database (`data/library.db`) is created and seeded on first start; delete it to reseed.

## Demo accounts

Password for all: `rare-books`

- `elena@atelier.lib`
- `june@atelier.lib`
- `harlan@atelier.lib`
- `iris@atelier.lib`
- `tomas@atelier.lib`
- `priya@atelier.lib`

## Layout

| File | What it is |
|---|---|
| `server.js` | HTTP server, REST API, static files |
| `db.js` | Schema, seed data, queries |
| `test.js` | End-to-end tests over HTTP |
| `public/` | Single-page frontend (HTML + CSS + JS) |
