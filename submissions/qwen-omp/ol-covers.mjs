// Restores Open Library covers via the same subject discovery the original
// seed used: one OL search per subject page, title → cover_i map, then assign
// covers.openlibrary.org URLs to seed books that lack one.
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://openlibrary.org';
const UA = 'aldbury-seed/1.0 (private library catalog fetch)';
const YEAR_MIN = 1500, YEAR_MAX = 1930, PAGE = 50, CAP = 9000, GAP = 150;
const SUBJECTS = [
  'poetry', 'history', 'philosophy', 'novel', 'religion', 'travel', 'biography',
  'science', 'art', 'law', 'medicine', 'music', 'politics', 'war',
  "children's literature", 'theater', 'psychology', 'economics',
];
const OUT = 'data/seed.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const titleKey = (t) => clean(t).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

async function getJSON(url) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    } catch {
      await sleep(2000 * attempt);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status >= 500 || res.status === 429) {
      await sleep(Math.min(5000 * attempt, 30000));
      continue;
    }
    return null;
  }
  return null;
}
// --- 1. Discover works with cover_i --------------------------------------------
const covers = new Map(); // titleKey -> { id, authors }
const offsets = new Map();
const CAP_WORKS = 10000;
let worksSeen = 0;
outer: for (let round = 0; round < 80; round++) {
  let progress = false;
  for (const subject of SUBJECTS) {
    if (worksSeen >= CAP_WORKS) break outer;
    const offset = offsets.get(subject) || 0;
    const q = encodeURIComponent(`subject:${subject} first_publish_year:[${YEAR_MIN} TO ${YEAR_MAX}]`);
    const d = await getJSON(`${BASE}/search.json?q=${q}&limit=${PAGE}&offset=${offset}`);
    const docs = d?.docs || [];
    if (!docs.length) continue;
    offsets.set(subject, offset + docs.length);
    worksSeen += docs.length;
    for (const w of docs) {
      if (!w.cover_i) continue;
      const key = titleKey(w.title);
      if (!key || covers.has(key)) continue;
      covers.set(key, { id: w.cover_i, authors: (w.author_name || []).join(' ').toLowerCase() });
    }
    progress = true;
    if (docs.length < PAGE) continue;
    await sleep(GAP);
  }
  if (!progress) break;
}
console.log(`scanned ${worksSeen} works, ${covers.size} OL cover mappings`);

// --- 2. Assign covers -----------------------------------------------------------
const books = JSON.parse(readFileSync(OUT, 'utf8'));
let added = 0, missed = 0;
for (const b of books) {
  if (b.cover) continue;
  const m = covers.get(titleKey(b.title));
  if (!m) { missed++; continue; }
  const last = (b.author || '').toLowerCase().split(/\s+/).pop() || '';
  if (last.length >= 3 && m.authors && !m.authors.includes(last)) { missed++; continue; }
  b.cover = `https://covers.openlibrary.org/m/id/${m.id}-M.jpg`;
  added++;
}
writeFileSync(OUT, JSON.stringify(books));
console.log(`covers added: ${added}, missed: ${missed}`);
console.log(`with cover: ${books.filter((b) => b.cover).length}/${books.length}`);
