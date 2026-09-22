// Builds data/seed.json — a real rare-book catalog (5400+ titles, 1500–1930)
// for the Aldbury library. Sources:
//   1. Internet Archive advanced search  — titles, authors, dates, catalog descriptions (fast, inline)
//   2. Wikipedia REST summaries          — fallback descriptions + cover art, by exact title
// Resumable: progress lives in data/fetch-progress.json; safe to re-run.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TARGET = 5400;
const PAGES = 8; // per subject
const YEAR_MIN = 1500;
const YEAR_MAX = 1930;

const IA = 'https://archive.org/advancedsearch.php';
const WIKI = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const UA = { 'User-Agent': 'Aldbury/1.0 (private library seed build; contact: dan@atelier.lib)' };

const SUBJECTS = [
  'poetry', 'novels', 'history', 'philosophy', 'religion', 'travel', 'biography',
  'science', 'medicine', 'art', 'law', 'music', 'theater', 'politics',
  'war', 'economics', 'psychology', 'childrens literature',
];

const OUT = join('data', 'seed.json');
const PROG = join('data', 'fetch-progress.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- shared text helpers ------------------------------------------------------
const norm = (s) => (Array.isArray(s) ? s.join(' ') : (s || '')).replace(/\s+/g, ' ').trim();
const cleanText = (s) => norm(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const titleKey = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);

function authorFrom(creator) {
  let a = Array.isArray(creator) ? creator[0] : creator;
  a = norm(a);
  if (!a) return '';
  a = a.replace(/,?\s*\d{3,4}\s*[-–]\s*\d{0,4}/g, '').replace(/,?\s*\d{3,4}$/g, '').trim();
  a = a.replace(/\b(compiler|editor|illustrator|translator|author)\b.*$/i, '').trim();
  const parts = a.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts.slice(1).join(' ')} ${parts[0]}`;
  return a;
}

function yearOf(date) {
  const m = /(\d{4})/.exec(norm(date));
  return m ? Number(m[1]) : null;
}

const goodDesc = (b) => {
  const words = (b.description || '').split(' ').filter((w) => /[a-z]{3,}/i.test(w));
  return (b.description || '').length >= 60 && words.length >= 8;
};

// --- global 429 breaker (pause all requests) ----------------------------------
let pausedUntil = 0;
const pause = (ms) => { pausedUntil = Math.max(pausedUntil, Date.now() + ms); };
async function hold() {
  let w = pausedUntil - Date.now();
  while (w > 0) { await sleep(w); w = pausedUntil - Date.now(); }
}

async function getJSON(url, breaker = false) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await hold();
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow' });
      if (r.status === 429) {
        if (breaker) pause(20000);
        await sleep(1000 * attempt);
        continue;
      }
      const body = await r.json().catch(() => null);
      return { status: r.status, body };
    } catch {
      await sleep(1000 * attempt);
    }
  }
  return { status: 0, body: null };
}

// --- 1. Discover candidate books via Internet Archive --------------------------
let progress = existsSync(PROG) ? JSON.parse(readFileSync(PROG, 'utf8')) : { wikiDone: [], books: [] };
let candidates = progress.iaCandidates || null;

if (!Array.isArray(candidates)) {
  candidates = [];
  const seen = new Set();
  for (const subject of SUBJECTS) {
    for (let page = 1; page <= PAGES; page++) {
      const q = encodeURIComponent(`mediatype:(texts) subject:(${subject}) date:[${YEAR_MIN} TO ${YEAR_MAX}]`);
      const { body } = await getJSON(
        `${IA}?q=${q}&fl[]=title&fl[]=creator&fl[]=date&fl[]=description&rows=100&page=${page}&output=json`
      );
      const docs = body?.response?.docs || [];
      if (!docs.length) break;
      for (const d of docs) {
        const title = cleanText(d.title);
        if (title.length < 3) continue;
        const key = titleKey(title);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ title, author: authorFrom(d.creator), year: yearOf(d.date), description: cleanText(d.description) });
      }
      if (page === PAGES) break;
      await sleep(250);
    }
  }
  candidates = candidates || [];
  console.log(`IA discovery: ${candidates.length} candidate titles`);
  progress.iaCandidates = candidates;
  writeFileSync(PROG, JSON.stringify(progress));
} else {
  console.log(`Resuming: ${candidates.length} candidates on file`);
}

// --- 2. Merge: prior seed (Open Library books) + new candidates ----------------
const books = [];
const known = new Set();
const pushBook = (b) => {
  const k = titleKey(b.title);
  if (!k || known.has(k)) return;
  known.add(k);
  books.push(b);
};

if (existsSync(OUT)) {
  const prior = JSON.parse(readFileSync(OUT, 'utf8'));
  prior.forEach(pushBook);
  console.log(`carried over ${prior.length} books from previous seed`);
}
(candidates || []).forEach((c) => {
  if (!c.author || !c.year || c.year < 1450 || c.year > YEAR_MAX + 10) return;
  pushBook(c);
});
for (const b of progress.books || []) pushBook(b);
console.log(`merged pool: ${books.length} books, ${books.filter(goodDesc).length} with good descriptions`);

// --- 3. Wikipedia: fill missing descriptions + covers --------------------------
const wikiDone = new Set(progress.wikiDone || []);
let wikiTried = 0;
for (const b of books) {
  if (books.filter(goodDesc).length >= TARGET) break;
  if (goodDesc(b) && b.cover) continue;
  if (wikiDone.has(b.title)) continue;
  wikiDone.add(b.title);
  wikiTried++;
  const { status, body } = await getJSON(`${WIKI}/${encodeURIComponent(b.title)}`, true);
  if (status === 200 && body?.extract) {
    const ex = body.extract.replace(/\s+/g, ' ').trim();
    const usable = ex.length >= 60 && !/may refer|the following are|is the name of/i.test(ex);
    const surname = (b.author || '').trim().split(/\s+/).pop();
    const named = !surname || surname.length < 3 || ex.toLowerCase().includes(surname.toLowerCase());
    if (usable && named) {
      if (!goodDesc(b)) b.description = ex;
      if (!b.cover && body.originalimage?.source) b.cover = body.originalimage.source;
    }
  }
  if (wikiTried % 100 === 0) {
    const good = books.filter(goodDesc).length;
    console.log(`wiki ${wikiTried}: ${good}/${TARGET} with descriptions`);
    writeFileSync(PROG, JSON.stringify({ ...progress, books, wikiDone: [...wikiDone] }));
  }
  await sleep(350);
}

// --- 4. Finalize ----------------------------------------------------------------
const final = books
  .filter((b) => b.title && b.author && b.year && b.year >= 1450 && b.year <= YEAR_MAX && goodDesc(b))
  .map((b) => ({ title: b.title, author: b.author, year: b.year, description: b.description, cover: b.cover || null }));

final.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
console.log(`\n${final.length} books pass the filters`);
console.log(`with cover: ${final.filter((b) => b.cover).length}`);
const years = final.map((b) => b.year);
console.log(`year span: ${Math.min(...years)}–${Math.max(...years)}`);

if (final.length < TARGET) {
  console.log(`\nBelow target ${TARGET} — re-run (progress is kept) to grow the pool.`);
}

mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify(final));
if (final.length >= TARGET) rmSync(PROG, { force: true });
console.log(`Wrote ${final.length} books to data/seed.json`);
