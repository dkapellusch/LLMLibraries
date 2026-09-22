import { scryptSync } from 'node:crypto'
import type { LibraryDatabase } from './db.js'
import { realBooks } from './catalog.js'

const SEED_DATE = '2026-01-15T12:00:00.000Z'
const BOOK_COUNT = Math.min(5184, realBooks.length)

export const locations = [
  { id: 'location-luna-house', name: 'Luna House', city: 'Edinburgh', description: 'The reading rooms and public-facing collection, in a restored Georgian townhouse.' },
  { id: 'location-archive', name: 'The Archive', city: 'Oxford', description: 'Climate-controlled stacks for fragile, rare, and early printed works.' },
  { id: 'location-river-room', name: 'River Room', city: 'Paris', description: 'A smaller study collection focused on translation, travel, and correspondence.' },
  { id: 'location-north-stack', name: 'North Stack', city: 'Copenhagen', description: 'Modern literature, design, and the library’s growing collection of artists’ books.' },
]

const users = [
  { id: 'user-alex-morgan', email: 'alex@lunalibrary.test', name: 'Alex Morgan', role: 'member' as const, password: 'luna-demo' },
  { id: 'user-beatrice-lee', email: 'beatrice@lunalibrary.test', name: 'Beatrice Lee', role: 'member' as const, password: 'luna-demo' },
  { id: 'user-julian-reed', email: 'julian@lunalibrary.test', name: 'Julian Reed', role: 'librarian' as const, password: 'luna-curator' },
]

const genres = ['Literature', 'History', 'Philosophy', 'Science', 'Art & Design', 'Travel', 'Nature', 'Letters']

function passwordHash(password: string): string {
  const salt = 'library-luna-demo-salt'
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function languageName(code: string): string {
  const names: Record<string, string> = { eng: 'English', fre: 'French', fra: 'French', ger: 'German', deu: 'German', spa: 'Spanish', ita: 'Italian', por: 'Portuguese', rus: 'Russian', jpn: 'Japanese', chi: 'Chinese' }
  return names[code] ?? code.toUpperCase()
}

function genreFor(subjects: string[]): string {
  const text = subjects.join(' ').toLowerCase()
  if (/poetry|poems|verse/.test(text)) return 'Literature'
  if (/philosoph|ethics|metaphysics/.test(text)) return 'Philosophy'
  if (/science|physics|biology|mathematics|chemistry/.test(text)) return 'Science'
  if (/art|design|painting|architecture|photograph/.test(text)) return 'Art & Design'
  if (/travel|voyage|journey|geograph/.test(text)) return 'Travel'
  if (/nature|birds|plants|animals|ecology/.test(text)) return 'Nature'
  if (/letter|correspondence|diary|memoir|biograph/.test(text)) return 'Letters'
  if (/history|historical|civilization|war/.test(text)) return 'History'
  return genres[subjects.length % genres.length]
}

function bookFor(index: number, usedIsbns: Set<string>) {
  const source = realBooks[index]
  const id = `book-${String(index + 1).padStart(5, '0')}`
  const isbn = source.isbn && !usedIsbns.has(source.isbn) ? source.isbn : null
  if (isbn) usedIsbns.add(isbn)
  const subjects = source.subjects.length ? source.subjects : ['General works']
  const genre = genreFor(subjects)
  const location = locations[index % locations.length]
  const sourceUrl = `https://openlibrary.org${source.sourceKey.startsWith('/') ? source.sourceKey : `/works/${source.sourceKey}`}`
  return {
    id,
    catalogCode: `LUNA-${String(index + 1).padStart(5, '0')}`,
    isbn,
    title: source.title,
    author: source.author,
    description: `Open Library subjects: ${subjects.slice(0, 3).join(', ')}. This ${genre.toLowerCase()} record was imported from the Open Library work catalogue for the Luna Library collection.`,
    genre,
    language: languageName(source.language),
    publicationYear: Math.max(1000, Math.min(new Date().getFullYear(), source.firstPublishYear || 1900)),
    pages: source.pages,
    coverId: source.coverId,
    sourceUrl,
    locationId: location.id,
  }
}

export function seedDatabase(db: LibraryDatabase): void {
  const seed = db.transaction(() => {
    const insertLocation = db.prepare(`
      INSERT INTO locations (id, name, city, description, created_at)
      VALUES (@id, @name, @city, @description, @createdAt)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, city = excluded.city, description = excluded.description
    `)
    for (const location of locations) insertLocation.run({ ...location, createdAt: SEED_DATE })

    const insertUser = db.prepare(`
      INSERT INTO users (id, email, name, password_hash, role, created_at)
      VALUES (@id, @email, @name, @passwordHash, @role, @createdAt)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, password_hash = excluded.password_hash, role = excluded.role
    `)
    for (const user of users) insertUser.run({ ...user, passwordHash: passwordHash(user.password), createdAt: SEED_DATE })

    const insertBook = db.prepare(`
      INSERT INTO books (
        id, catalog_code, isbn, title, author, description, genre, language,
        publication_year, pages, cover_id, source_url, location_id, created_at
      ) VALUES (
        @id, @catalogCode, @isbn, @title, @author, @description, @genre, @language,
        @publicationYear, @pages, @coverId, @sourceUrl, @locationId, @createdAt
      )
      ON CONFLICT(id) DO UPDATE SET
        catalog_code = excluded.catalog_code, isbn = excluded.isbn, title = excluded.title,
        author = excluded.author, description = excluded.description, genre = excluded.genre,
        language = excluded.language, publication_year = excluded.publication_year, pages = excluded.pages,
        cover_id = excluded.cover_id, source_url = excluded.source_url, location_id = excluded.location_id
    `)
    const usedIsbns = new Set<string>()
    for (let index = 0; index < BOOK_COUNT; index += 1) insertBook.run({ ...bookFor(index, usedIsbns), createdAt: SEED_DATE })

    const insertReview = db.prepare(`
      INSERT INTO reviews (id, book_id, user_id, rating, body, created_at, updated_at)
      VALUES (@id, @bookId, @userId, @rating, @body, @createdAt, @updatedAt)
      ON CONFLICT(book_id, user_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, updated_at = excluded.updated_at
    `)
    const reviewSeeds = [
      ['review-001', 'book-00001', 'user-alex-morgan', 5, 'A beautiful, patient book. The marginalia alone is worth an afternoon.'],
      ['review-002', 'book-00002', 'user-beatrice-lee', 4, 'Quietly absorbing and unusually well preserved.'],
      ['review-003', 'book-00003', 'user-julian-reed', 5, 'A cornerstone of the collection, with a wonderful provenance.'],
      ['review-004', 'book-00024', 'user-alex-morgan', 4, 'Thoughtful illustrations and a surprisingly modern voice.'],
      ['review-005', 'book-00240', 'user-beatrice-lee', 5, 'One of the books I return to whenever I need to slow down.'],
      ['review-006', 'book-02400', 'user-julian-reed', 3, 'Dense, but rewarding when read alongside the companion volume.'],
    ] as const
    for (const [id, bookId, userId, rating, body] of reviewSeeds) insertReview.run({ id, bookId, userId, rating, body, createdAt: SEED_DATE, updatedAt: SEED_DATE })

    const insertLoan = db.prepare(`
      INSERT INTO loans (id, book_id, user_id, checked_out_at, due_at, returned_at, renewal_count, max_renewals)
      VALUES (@id, @bookId, @userId, @checkedOutAt, @dueAt, @returnedAt, @renewalCount, @maxRenewals)
      ON CONFLICT(id) DO UPDATE SET book_id = excluded.book_id, user_id = excluded.user_id, checked_out_at = excluded.checked_out_at,
        due_at = excluded.due_at, returned_at = excluded.returned_at, renewal_count = excluded.renewal_count, max_renewals = excluded.max_renewals
    `)
    insertLoan.run({ id: 'loan-demo-alex', bookId: 'book-00001', userId: 'user-alex-morgan', checkedOutAt: '2026-01-10T12:00:00.000Z', dueAt: '2026-02-10T12:00:00.000Z', returnedAt: null, renewalCount: 1, maxRenewals: 2 })
    insertLoan.run({ id: 'loan-demo-returned', bookId: 'book-00002', userId: 'user-beatrice-lee', checkedOutAt: '2025-12-01T12:00:00.000Z', dueAt: '2026-01-01T12:00:00.000Z', returnedAt: '2025-12-22T12:00:00.000Z', renewalCount: 0, maxRenewals: 2 })

    const insertReservation = db.prepare(`
      INSERT INTO reservations (id, book_id, user_id, status, created_at, cancelled_at, fulfilled_at)
      VALUES (@id, @bookId, @userId, @status, @createdAt, @cancelledAt, @fulfilledAt)
      ON CONFLICT(id) DO UPDATE SET book_id = excluded.book_id, user_id = excluded.user_id, status = excluded.status,
        created_at = excluded.created_at, cancelled_at = excluded.cancelled_at, fulfilled_at = excluded.fulfilled_at
    `)
    insertReservation.run({ id: 'reservation-demo-beatrice', bookId: 'book-00003', userId: 'user-beatrice-lee', status: 'active', createdAt: SEED_DATE, cancelledAt: null, fulfilledAt: null })
  })

  seed()
}

export const seedConstants = { BOOK_COUNT, SEED_DATE, source: 'Open Library Search API' }
