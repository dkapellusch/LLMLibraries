# Aldbury

Two one-shot LLM submissions for the same library application prompt, kept
side by side as a small, runnable comparison.

Aldbury is a private rare-book library with multiple locations, catalog
search, member accounts, reservations, queueing, renewals, returns, and
reviews. The default demo is the Qwen/OMP submission because it is the most
complete end-to-end implementation and runs with Node's built-in SQLite — no
package install or build step required.

## The submissions

| Submission | Stack | Inventory | Verification |
| --- | --- | ---: | --- |
| [Qwen / OMP](submissions/qwen-omp/) | Node.js, SQLite, vanilla HTML/CSS/JS | 6,330 books, 1,601 reviews | 33 end-to-end API checks |
| [Luna](submissions/luna/) | React, Vite, Express, better-sqlite3 | 5,184 books, 6 seeded reviews | Vitest + TypeScript/Vite build |

The prompt is preserved in [PROMPT.md](PROMPT.md). Each submission retains its
own README and test suite so the comparison stays reproducible.

## Run the default demo

```sh
cd submissions/qwen-omp
node --version   # Node 22.5+ for node:sqlite
npm test
npm start
```

Open <http://localhost:4000>. The first launch creates and seeds
`data/library.db` from the checked-in `data/seed.json`; the generated database
is ignored by Git.

Demo password: `rare-books`

```text
elena@atelier.lib
june@atelier.lib
harlan@atelier.lib
iris@atelier.lib
tomas@atelier.lib
priya@atelier.lib
```

## Run Luna

```sh
cd submissions/luna
npm install
npm test
npm run build
npm run dev
```

The React client runs at <http://localhost:5173> and proxies API requests to
the Express server at <http://localhost:3000>. Its demo account is
`alex@lunalibrary.test` with password `luna-demo`.

## Why preserve both?

This is an implementation comparison, not a blended rewrite. The Qwen
submission favors a small dependency surface and a richer domain test suite;
the Luna submission explores a more expressive React client and a different
data model. Keeping the original boundaries makes the one-shot results easy
to inspect, run, and discuss.

## Data

The Qwen catalog is sourced from public Internet Archive, Wikipedia, and Open
Library metadata referenced by its seed script. Luna includes an Open Library
catalog source in `server/catalog-source.json`. Covers are remote URLs when
available; the applications remain usable without them.

## License

MIT. See [LICENSE](LICENSE).
