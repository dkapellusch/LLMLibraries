// Assigns Internet Archive first-page images as covers for books that have none.
// Uses the identifier map built by repair-seed.mjs (data/repair-progress.json).
// No network needed: the UI falls back to a monogram if an item has no image.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const IA = 'https://archive.org/advancedsearch.php';
const UA = { 'User-Agent': 'Aldbury/1.0 (private library seed build; contact: dan@atelier.lib)' };
const YEAR_MIN = 1500, YEAR_MAX = 1930, PAGES = 8;
const SUBJECTS = [
  'poetry', 'novels', 'history', 'philosophy', 'religion', 'travel', 'biography',
  'science', 'medicine', 'art', 'law', 'music', 'theater', 'politics',
  'war', 'economics', 'psychology', 'childrens literature',
];

const OUT = 'data/seed.json';
const PROG = 'data/repair-progress.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanText = (s) => (Array.isArray(s) ? s.join(' ') : (s || '')).replace(/\s+/g, ' ').replace(/<[^>]+>/g, ' ').trim();
const titleKey = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
let idByTitle = existsSync(PROG) ? JSON.parse(readFileSync(PROG, 'utf8')).byTitle || {} : {};

if (Object.keys(idByTitle).length === 0) {
  const seen = new Set();
  for (const subject of SUBJECTS) {
    for (let page = 1; page <= PAGES; page++) {
      const q = encodeURIComponent(`mediatype:(texts) subject:(${subject}) date:[${YEAR_MIN} TO ${YEAR_MAX}]`);
      const r = await fetch(`${IA}?q=${q}&fl[]=identifier&fl[]=title&rows=100&page=${page}&output=json`, { headers: UA });
      const body = await r.json().catch(() => null);
      const docs = body?.response?.docs || [];
      if (!docs.length) break;
      for (const d of docs) {
        const key = titleKey(cleanText(d.title));
        if (!key || seen.has(key)) continue;
        seen.add(key);
        idByTitle[key] = d.identifier;
      }
      if (page === PAGES) break;
      await sleep(200);
    }
  }
  console.log(`re-discovered ${Object.keys(idByTitle).length} identifiers`);
}

const books = JSON.parse(readFileSync(OUT, 'utf8'));

let added = 0, noId = 0;
for (const b of books) {
  if (b.cover) continue;
  const id = idByTitle[titleKey(b.title)];
  if (!id) { noId++; continue; }
  b.cover = `https://archive.org/services/img/${id}?size=250`;
  added++;
}
writeFileSync(OUT, JSON.stringify(books));
console.log(`covers added: ${added}, no IA id: ${noId}, already had cover: ${books.filter((b) => !b.cover).length === noId ? 'n/a' : books.filter((b) => !b.cover).length}`);
console.log(`with cover: ${books.filter((b) => b.cover).length}/${books.length}`);
