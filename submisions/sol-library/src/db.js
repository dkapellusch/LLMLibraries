import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LOCATIONS = [
  ['Aster House', '12 Wren Street', 'Quiet reading rooms and the main humanities collection.'],
  ['North Archive', '88 Calder Avenue', 'Climate-controlled stacks for early printed works.'],
  ['Mariner Room', '4 Quay Lane', 'Travel, natural history, maps, and maritime works.'],
  ['Orchard Annex', '210 Orchard Road', 'Modern fine press, art, and rotating exhibitions.']
];

const CURATED = [
  ['The Book of Disquiet', 'Fernando Pessoa', 1982, 'A mosaic of fragments, reveries, and observations from an imagined bookkeeper in Lisbon.', 'Literature,Philosophy'],
  ['The Waves', 'Virginia Woolf', 1931, 'Six voices rise and recede across a lifetime in Woolf’s most musical novel.', 'Literature,Modernism'],
  ['The Anatomy of Melancholy', 'Robert Burton', 1621, 'An immense, humane inquiry into sorrow, learning, medicine, and the restless mind.', 'History,Philosophy'],
  ['The Peregrine', 'J. A. Baker', 1967, 'A season spent following peregrine falcons across the winter landscape of Essex.', 'Natural History,Nature'],
  ['Invisible Cities', 'Italo Calvino', 1972, 'Marco Polo describes impossible cities to Kublai Khan in precise, crystalline fables.', 'Literature,Travel'],
  ['The Poetics of Space', 'Gaston Bachelard', 1958, 'An intimate study of rooms, nests, drawers, and the spaces that shape imagination.', 'Architecture,Philosophy'],
  ['A Sand County Almanac', 'Aldo Leopold', 1949, 'Seasonal observations that formed a foundational argument for a land ethic.', 'Natural History,Ecology'],
  ['The Snow Leopard', 'Peter Matthiessen', 1978, 'A Himalayan journey in search of a rare animal and a quieter way of seeing.', 'Travel,Natural History'],
  ['The Notebooks of Malte Laurids Brigge', 'Rainer Maria Rilke', 1910, 'A young poet records the splendor and terror of solitude in Paris.', 'Literature,Poetry'],
  ['The Left Hand of Darkness', 'Ursula K. Le Guin', 1969, 'An envoy crosses a frozen world while learning how culture shapes every human bond.', 'Science Fiction,Literature'],
  ['Labyrinths', 'Jorge Luis Borges', 1962, 'Stories and essays of mirrors, infinite libraries, memory, and imagined worlds.', 'Literature,Essays'],
  ['The Living Mountain', 'Nan Shepherd', 1977, 'A spare, sensuous account of knowing the Cairngorms through long attention.', 'Nature,Travel'],
  ['The Odyssey', 'Homer', -700, 'A foundational epic of wandering, endurance, and the difficult passage home.', 'Classics,Poetry'],
  ['On Colour', 'David Scott Kastan', 2018, 'A cultural history of color, its materials, language, politics, and shifting meanings.', 'Art,History'],
  ['Ways of Seeing', 'John Berger', 1972, 'Seven essays that changed how generations look at paintings, photographs, and publicity.', 'Art,Criticism'],
  ['The Rings of Saturn', 'W. G. Sebald', 1995, 'A walk along the Suffolk coast opens into a meditation on history and loss.', 'Literature,Travel'],
  ['Walden', 'Henry David Thoreau', 1854, 'An experiment in deliberate living beside a pond in Massachusetts.', 'Nature,Philosophy'],
  ['The Invention of Morel', 'Adolfo Bioy Casares', 1940, 'A fugitive on an island confronts an impossible machine and a recurring group of visitors.', 'Literature,Science Fiction'],
  ['The Sea Around Us', 'Rachel Carson', 1951, 'A lucid account of the ocean’s origins, movements, depths, and living systems.', 'Natural History,Science'],
  ['The Craftsman', 'Richard Sennett', 2008, 'A study of the desire to do a job well for its own sake.', 'Design,Philosophy'],
  ['The Man Who Planted Trees', 'Jean Giono', 1953, 'A quiet parable of one person restoring a ruined landscape over many years.', 'Literature,Nature'],
  ['The Peregrinations of a Pariah', 'Flora Tristan', 1838, 'A vivid account of travel, exclusion, and society in nineteenth-century Peru.', 'Travel,History'],
  ['The Compleat Angler', 'Izaak Walton', 1653, 'A pastoral celebration of rivers, friendship, observation, and the angler’s art.', 'Natural History,Classics'],
  ['The Narrow Road to the Deep North', 'Matsuo Bashō', 1702, 'A poet’s journey through northern Japan rendered in prose and haiku.', 'Poetry,Travel']
];

const AUTHORS = ['Ada Mercer', 'Julian Bell', 'Mara Voss', 'Edmund Hale', 'Iris North', 'Tobias Reed', 'Nell Armitage', 'Samuel Finch', 'Clara Vale', 'Elias Rowan', 'Alma Grey', 'Felix Marr'];
const THEMES = ['Botany', 'Book Arts', 'Cartography', 'Classical Studies', 'Design', 'Essays', 'Folklore', 'Natural History', 'Philosophy', 'Poetry', 'Travel', 'Typography'];
const NOUNS = ['Almanac', 'Archive', 'Atlas', 'Cabinet', 'Companion', 'Correspondence', 'Field Notes', 'Fragments', 'Gazetteer', 'Handbook', 'Observations', 'Studies'];
const ADJECTIVES = ['Aerial', 'Ancient', 'Blue', 'Common', 'Distant', 'Forgotten', 'Hidden', 'Littoral', 'Northern', 'Quiet', 'Small', 'Vernal'];

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, expectedHex] = stored.split(':');
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function openDatabase(path = process.env.SOL_DB_PATH || new URL('../data/library.db', import.meta.url).pathname) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, address TEXT NOT NULL, note TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, year INTEGER NOT NULL,
      description TEXT NOT NULL, subjects TEXT NOT NULL, edition TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'English', accent INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS copies (
      id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id),
      location_id INTEGER NOT NULL REFERENCES locations(id), shelf TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY, copy_id INTEGER NOT NULL REFERENCES copies(id),
      member_id INTEGER NOT NULL REFERENCES members(id), borrowed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      due_at TEXT NOT NULL, returned_at TEXT, renewals INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_loan_per_copy ON loans(copy_id) WHERE returned_at IS NULL;
    CREATE INDEX IF NOT EXISTS member_loans ON loans(member_id, returned_at);
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id),
      member_id INTEGER NOT NULL REFERENCES members(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','fulfilled','cancelled'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_wait_per_member_book ON reservations(book_id, member_id) WHERE status = 'waiting';
    CREATE INDEX IF NOT EXISTS reservation_queue ON reservations(book_id, status, created_at);
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id),
      member_id INTEGER NOT NULL REFERENCES members(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 8 AND 1200), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(book_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS book_title ON books(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS book_author ON books(author COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS copy_book_location ON copies(book_id, location_id);
  `);
}

export function seedDatabase(db, size = 5400) {
  const current = db.prepare('SELECT count(*) AS count FROM books').get().count;
  if (current >= size) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    const addLocation = db.prepare('INSERT OR IGNORE INTO locations(name,address,note) VALUES(?,?,?)');
    LOCATIONS.forEach((row) => addLocation.run(...row));
    db.prepare('INSERT OR IGNORE INTO members(name,email,password_hash) VALUES(?,?,?)')
      .run('Evelyn Hart', 'reader@asterhouse.test', hashPassword('quietbooks'));

    const addBook = db.prepare(`INSERT INTO books(title,author,year,description,subjects,edition,language,accent)
      VALUES(?,?,?,?,?,?,?,?)`);
    const addCopy = db.prepare('INSERT INTO copies(book_id,location_id,shelf) VALUES(?,?,?)');
    for (let i = current; i < size; i++) {
      let title, author, year, description, subjects;
      if (i < CURATED.length) {
        [title, author, year, description, subjects] = CURATED[i];
      } else {
        const theme = THEMES[i % THEMES.length];
        title = `${ADJECTIVES[(i * 7) % ADJECTIVES.length]} ${NOUNS[(i * 5 + Math.floor(i / 12)) % NOUNS.length]} of ${theme}`;
        if (i >= ADJECTIVES.length * NOUNS.length) title += `, Volume ${Math.floor(i / (ADJECTIVES.length * NOUNS.length)) + 1}`;
        author = AUTHORS[(i * 11) % AUTHORS.length];
        year = 1780 + ((i * 37) % 241);
        description = `A carefully produced ${theme.toLowerCase()} volume bringing together primary sources, illustrations, and considered commentary from the collection.`;
        subjects = `${theme},${THEMES[(i + 5) % THEMES.length]}`;
      }
      const result = addBook.run(title, author, year, description, subjects, i % 7 === 0 ? 'Limited edition' : 'Library edition', i % 19 === 0 ? 'French' : 'English', (i * 47) % 360);
      const bookId = Number(result.lastInsertRowid);
      const copies = i % 9 === 0 ? 2 : 1;
      for (let c = 0; c < copies; c++) {
        const location = ((i + c * 2) % LOCATIONS.length) + 1;
        addCopy.run(bookId, location, `${String.fromCharCode(65 + (i % 12))}.${String((i * 13 + c) % 999).padStart(3, '0')}`);
      }
    }

    const memberId = db.prepare('SELECT id FROM members WHERE email = ?').get('reader@asterhouse.test').id;
    const existingReviews = db.prepare('SELECT count(*) AS count FROM reviews').get().count;
    if (!existingReviews) {
      const addReview = db.prepare('INSERT INTO reviews(book_id,member_id,rating,body,created_at) VALUES(?,?,?,?,?)');
      addReview.run(1, memberId, 5, 'A book to live beside rather than simply finish. The fragments keep rearranging themselves in memory.', '2026-06-12 10:30:00');
      addReview.run(5, memberId, 5, 'Exact and weightless. Every city feels like a proposition you can carry into the day.', '2026-07-04 14:10:00');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function bookAvailabilitySql() {
  return `SELECT b.*, COUNT(DISTINCT c.id) AS copy_count,
    COUNT(DISTINCT CASE WHEN l.id IS NULL THEN c.id END) AS available_count,
    COUNT(DISTINCT CASE WHEN r.status='waiting' THEN r.id END) AS queue_count,
    ROUND(AVG(rv.rating),1) AS rating, COUNT(DISTINCT rv.id) AS review_count
    FROM books b
    JOIN copies c ON c.book_id=b.id
    LEFT JOIN loans l ON l.copy_id=c.id AND l.returned_at IS NULL
    LEFT JOIN reservations r ON r.book_id=b.id AND r.status='waiting'
    LEFT JOIN reviews rv ON rv.book_id=b.id`;
}

export function borrowOrQueue(db, memberId, bookId, locationId = null) {
  const ownLoan = db.prepare(`SELECT l.id FROM loans l JOIN copies c ON c.id=l.copy_id
    WHERE l.member_id=? AND c.book_id=? AND l.returned_at IS NULL`).get(memberId, bookId);
  if (ownLoan) throw Object.assign(new Error('You already have this title on loan.'), { status: 409 });
  const ownWait = db.prepare(`SELECT id FROM reservations WHERE member_id=? AND book_id=? AND status='waiting'`).get(memberId, bookId);
  if (ownWait) throw Object.assign(new Error('You are already in the queue for this title.'), { status: 409 });

  const copy = db.prepare(`SELECT c.id FROM copies c
    LEFT JOIN loans l ON l.copy_id=c.id AND l.returned_at IS NULL
    WHERE c.book_id=? AND l.id IS NULL AND (? IS NULL OR c.location_id=?)
    ORDER BY CASE WHEN c.location_id=? THEN 0 ELSE 1 END, c.id LIMIT 1`).get(bookId, locationId, locationId, locationId);
  if (copy) {
    const due = new Date(Date.now() + 21 * 86400000).toISOString();
    const result = db.prepare('INSERT INTO loans(copy_id,member_id,due_at) VALUES(?,?,?)').run(copy.id, memberId, due);
    return { kind: 'loan', id: Number(result.lastInsertRowid), dueAt: due };
  }
  const result = db.prepare('INSERT INTO reservations(book_id,member_id) VALUES(?,?)').run(bookId, memberId);
  const position = db.prepare(`SELECT count(*) AS n FROM reservations WHERE book_id=? AND status='waiting'
    AND (created_at < (SELECT created_at FROM reservations WHERE id=?) OR id <= ?)` ).get(bookId, result.lastInsertRowid, result.lastInsertRowid).n;
  return { kind: 'queue', id: Number(result.lastInsertRowid), position };
}

export function returnLoan(db, memberId, loanId) {
  const loan = db.prepare(`SELECT l.*, c.book_id FROM loans l JOIN copies c ON c.id=l.copy_id
    WHERE l.id=? AND l.member_id=? AND l.returned_at IS NULL`).get(loanId, memberId);
  if (!loan) throw Object.assign(new Error('Active loan not found.'), { status: 404 });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE loans SET returned_at=CURRENT_TIMESTAMP WHERE id=?").run(loanId);
    const next = db.prepare(`SELECT * FROM reservations WHERE book_id=? AND status='waiting' ORDER BY created_at,id LIMIT 1`).get(loan.book_id);
    if (next) {
      const due = new Date(Date.now() + 21 * 86400000).toISOString();
      db.prepare('INSERT INTO loans(copy_id,member_id,due_at) VALUES(?,?,?)').run(loan.copy_id, next.member_id, due);
      db.prepare("UPDATE reservations SET status='fulfilled' WHERE id=?").run(next.id);
    }
    db.exec('COMMIT');
    return { promoted: Boolean(next) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
