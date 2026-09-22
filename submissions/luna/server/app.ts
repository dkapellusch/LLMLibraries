import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import type { LibraryDatabase } from './db.js'
import { openDatabase } from './db.js'
import type { PublicUser } from './types.js'

const SESSION_COOKIE = 'library_session'
const DEFAULT_SESSION_DAYS = 30
const DEFAULT_LOAN_DAYS = 21

export interface CreateAppOptions {
  db?: LibraryDatabase
  dbPath?: string
  sessionDays?: number
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function bodyOf(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
}

function stringField(value: unknown, field: string, maxLength = 2000): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, `${field} is required`)
  }
  const result = value.trim()
  if (result.length > maxLength) throw new HttpError(400, `${field} is too long`)
  return result
}

function optionalString(value: unknown, maxLength = 2000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return stringField(value, 'value', maxLength)
}

function publicUser(row: { id: string; email: string; name: string; role: string }): PublicUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role as PublicUser['role'] }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(header.split(';').flatMap((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return []
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    return name ? [[name, decodeURIComponent(value)] as const] : []
  }))
}

function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`)
}

function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)
}

function requireUser(req: Request, res: Response): PublicUser | undefined {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return undefined
  }
  return req.user
}

function verifyPassword(password: string, stored: string): boolean {
  const separator = stored.indexOf(':')
  if (separator < 0) return false
  const salt = stored.slice(0, separator)
  const expected = Buffer.from(stored.slice(separator + 1), 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual)
}

function bookFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    catalogCode: row.catalog_code,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    description: row.description,
    genre: row.genre,
    language: row.language,
    publicationYear: row.publication_year,
    pages: row.pages,
    coverId: row.cover_id,
    sourceUrl: row.source_url,
    location: { id: row.location_id, name: row.location_name, city: row.location_city },
    available: Boolean(row.available),
    ...(row.average_rating !== undefined ? {
      averageRating: row.average_rating === null ? null : Math.round(Number(row.average_rating) * 10) / 10,
      reviewCount: Number(row.review_count ?? 0),
    } : {}),
    ...(row.reserved_by_me !== undefined ? { reservedByMe: Boolean(row.reserved_by_me) } : {}),
  }
}

function reservationFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    fulfilledAt: row.fulfilled_at,
    pickupLocationId: row.pickup_location_id ?? row.location_id,
    book: {
      id: row.book_id,
      title: row.title,
      author: row.author,
      catalogCode: row.catalog_code,
      location: row.location_name,
    },
  }
}

function loanFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    checkedOutAt: row.checked_out_at,
    dueAt: row.due_at,
    returnedAt: row.returned_at,
    renewalCount: row.renewal_count,
    maxRenewals: row.max_renewals,
    renewable: row.returned_at === null && Number(row.renewal_count) < Number(row.max_renewals),
    book: {
      id: row.book_id,
      title: row.title,
      author: row.author,
      catalogCode: row.catalog_code,
      location: row.location_name,
    },
  }
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const ownsDatabase = !options.db
  const db = options.db ?? openDatabase(options.dbPath)
  const sessionDays = options.sessionDays ?? DEFAULT_SESSION_DAYS
  const app = express()

  app.locals.libraryDb = db
  app.locals.closeDatabase = () => {
    if (ownsDatabase && db.open) db.close()
  }

  app.disable('x-powered-by')
  app.use(express.json({ limit: '32kb' }))

  app.use((req, res, next) => {
    const allowedOrigin = process.env.LIBRARY_CORS_ORIGIN
    const origin = req.header('origin')
    if (allowedOrigin && origin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  app.use((req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (token) {
      const row = db.prepare(`
        SELECT u.id, u.email, u.name, u.role
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?
      `).get(token, nowIso()) as { id: string; email: string; name: string; role: string } | undefined
      if (row) {
        req.user = publicUser(row)
        req.sessionToken = token
      }
    }
    next()
  })

  app.get('/api/health', (_req, res) => {
    const row = db.prepare('SELECT COUNT(*) AS count FROM books').get() as { count: number }
    res.json({ ok: true, service: 'library-luna', books: row.count })
  })

  app.post('/api/auth/login', (req, res) => {
    const body = bodyOf(req)
    const email = stringField(body.email, 'email', 320).toLowerCase()
    const password = stringField(body.password, 'password', 200)
    const row = db.prepare(`
      SELECT id, email, name, role, password_hash
      FROM users WHERE email = ?
    `).get(email) as { id: string; email: string; name: string; role: string; password_hash: string } | undefined
    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Email or password is incorrect' })
      return
    }

    const token = randomBytes(32).toString('hex')
    const createdAt = nowIso()
    const expiresAt = addDays(createdAt, sessionDays)
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(createdAt)
    db.prepare(`
      INSERT INTO sessions (token, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(token, row.id, expiresAt, createdAt)
    setSessionCookie(res, token, sessionDays * 24 * 60 * 60)
    res.json({ user: publicUser(row) })
  })

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken)
    clearSessionCookie(res)
    res.status(204).end()
  })

  app.get('/api/auth/me', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    res.json({ user })
  })

  const catalogSearch = (req: Request, res: Response) => {
    const query = optionalString(req.query.query ?? req.query.q, 120)
    const author = optionalString(req.query.author, 120)
    const genre = optionalString(req.query.genre, 80)
    const locationId = optionalString(req.query.locationId ?? req.query.location, 80)
    const availability = optionalString(req.query.available, 10)
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
    const pageSize = Math.min(48, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '24'), 10) || 24))
    const params: Record<string, string | number> = {}
    const where = ['1 = 1']

    if (query) {
      params.search = `%${query}%`
      where.push('(b.title LIKE @search OR b.author LIKE @search OR b.description LIKE @search OR b.genre LIKE @search OR b.catalog_code LIKE @search)')
    }
    if (author) {
      params.author = `%${author}%`
      where.push('b.author LIKE @author')
    }
    if (genre) {
      params.genre = genre
      where.push('b.genre = @genre')
    }
    if (locationId) {
      params.locationId = locationId
      where.push('b.location_id = @locationId')
    }
    const availableSql = `NOT EXISTS (SELECT 1 FROM loans al WHERE al.book_id = b.id AND al.returned_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM reservations ar WHERE ar.book_id = b.id AND ar.status = 'active')`
    if (availability === 'true') where.push(availableSql)
    if (availability === 'false') where.push(`NOT (${availableSql})`)

    const sort = String(req.query.sort ?? 'title')
    const sortSql: Record<string, string> = {
      title: 'b.title COLLATE NOCASE ASC',
      author: 'b.author COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC',
      newest: 'b.publication_year DESC, b.title COLLATE NOCASE ASC',
      oldest: 'b.publication_year ASC, b.title COLLATE NOCASE ASC',
    }
    const orderBy = sortSql[sort] ?? sortSql.title
    const whereSql = where.join(' AND ')
    const count = db.prepare(`SELECT COUNT(*) AS count FROM books b WHERE ${whereSql}`).get(params) as { count: number }
    params.limit = pageSize
    params.offset = (page - 1) * pageSize
    const rows = db.prepare(`
      SELECT
        b.id, b.catalog_code, b.isbn, b.title, b.author, b.description, b.genre, b.language,
        b.publication_year, b.pages, b.cover_id, b.source_url, b.location_id, l.name AS location_name, l.city AS location_city,
        (SELECT AVG(rating) FROM reviews WHERE book_id = b.id) AS average_rating,
        (SELECT COUNT(*) FROM reviews WHERE book_id = b.id) AS review_count,
        CASE WHEN ${availableSql} THEN 1 ELSE 0 END AS available,
        CASE WHEN EXISTS (
          SELECT 1 FROM reservations mine
          WHERE mine.book_id = b.id AND mine.user_id = @userId AND mine.status = 'active'
        ) THEN 1 ELSE 0 END AS reserved_by_me
      FROM books b
      JOIN locations l ON l.id = b.location_id
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT @limit OFFSET @offset
    `).all({ ...params, userId: req.user?.id ?? '' }) as Record<string, unknown>[]

    res.json({
      items: rows.map(bookFromRow),
      total: count.count,
      page,
      pageSize,
      totalPages: Math.ceil(count.count / pageSize),
    })
  }

  const catalogDetail = (req: Request, res: Response) => {
    const row = db.prepare(`
      SELECT
        b.id, b.catalog_code, b.isbn, b.title, b.author, b.description, b.genre, b.language,
        b.publication_year, b.pages, b.cover_id, b.source_url, b.location_id, l.name AS location_name, l.city AS location_city,
        CASE WHEN NOT EXISTS (
          SELECT 1 FROM loans al WHERE al.book_id = b.id AND al.returned_at IS NULL
        ) AND NOT EXISTS (
          SELECT 1 FROM reservations ar WHERE ar.book_id = b.id AND ar.status = 'active'
        ) THEN 1 ELSE 0 END AS available,
        CASE WHEN EXISTS (
          SELECT 1 FROM reservations mine
          WHERE mine.book_id = b.id AND mine.user_id = @userId AND mine.status = 'active'
        ) THEN 1 ELSE 0 END AS reserved_by_me,
        AVG(r.rating) AS average_rating,
        COUNT(r.id) AS review_count
      FROM books b
      JOIN locations l ON l.id = b.location_id
      LEFT JOIN reviews r ON r.book_id = b.id
      WHERE b.id = @bookId OR b.catalog_code = @bookId
      GROUP BY b.id
    `).get({ bookId: req.params.bookId, userId: req.user?.id ?? '' }) as Record<string, unknown> | undefined
    if (!row) throw new HttpError(404, 'Book not found')

    const reviews = db.prepare(`
      SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.id AS user_id, u.name AS user_name
      FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.book_id = ?
      ORDER BY r.created_at DESC
    `).all(row.id) as Record<string, unknown>[]

    res.json({
      book: bookFromRow(row),
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        body: review.body,
        createdAt: review.created_at,
        updatedAt: review.updated_at,
        user: { id: review.user_id, name: review.user_name },
      })),
    })
  }

  const catalogReviews = (req: Request, res: Response) => {
    const book = db.prepare('SELECT id FROM books WHERE id = ? OR catalog_code = ?').get(req.params.bookId, req.params.bookId) as { id: string } | undefined
    if (!book) throw new HttpError(404, 'Book not found')
    const reviews = db.prepare(`
      SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.id AS user_id, u.name AS user_name
      FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.book_id = ? ORDER BY r.created_at DESC
    `).all(book.id) as Record<string, unknown>[]
    res.json({ reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      body: review.body,
      createdAt: review.created_at,
      updatedAt: review.updated_at,
      user: { id: review.user_id, name: review.user_name },
    })) })
  }

  app.get('/api/catalog', catalogSearch)
  app.get('/api/books', catalogSearch)
  app.get('/api/catalog/:bookId/reviews', catalogReviews)
  app.get('/api/catalog/:bookId', catalogDetail)
  app.get('/api/books/:bookId', catalogDetail)

  app.get('/api/locations', (_req, res) => {
    const rows = db.prepare(`
      SELECT
        l.id, l.name, l.city, l.description,
        COUNT(b.id) AS book_count,
        SUM(CASE WHEN b.id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM loans al WHERE al.book_id = b.id AND al.returned_at IS NULL
        ) AND NOT EXISTS (
          SELECT 1 FROM reservations ar WHERE ar.book_id = b.id AND ar.status = 'active'
        ) THEN 1 ELSE 0 END) AS available_count
      FROM locations l
      LEFT JOIN books b ON b.location_id = l.id
      GROUP BY l.id ORDER BY l.name COLLATE NOCASE
    `).all() as Record<string, unknown>[]
    res.json({ locations: rows.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      description: row.description,
      bookCount: Number(row.book_count),
      availableCount: Number(row.available_count ?? 0),
    })) })
  })

  app.get('/api/reservations', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const rows = db.prepare(`
      SELECT r.id, r.status, r.created_at, r.cancelled_at, r.fulfilled_at, r.pickup_location_id,
        b.id AS book_id, b.title, b.author, b.catalog_code, l.id AS location_id, l.name AS location_name
      FROM reservations r
      JOIN books b ON b.id = r.book_id
      JOIN locations l ON l.id = b.location_id
      WHERE r.user_id = ? AND r.status = 'active' ORDER BY r.created_at DESC
    `).all(user.id) as Record<string, unknown>[]
    res.json({ reservations: rows.map(reservationFromRow) })
  })

  app.post('/api/reservations', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const bookId = stringField(bodyOf(req).bookId, 'bookId', 100)
    const pickupLocationId = optionalString(bodyOf(req).pickupLocationId, 100)
    const createdAt = nowIso()
    const reservationId = randomUUID()
    const createReservation = db.transaction(() => {
      const book = db.prepare('SELECT id FROM books WHERE id = ? OR catalog_code = ?').get(bookId, bookId) as { id: string } | undefined
      if (!book) throw new HttpError(404, 'Book not found')
      const existing = db.prepare(`
        SELECT id, user_id FROM reservations WHERE book_id = ? AND status = 'active'
      `).all(book.id) as { id: string; user_id: string }[]
      if (existing.some((reservation) => reservation.user_id === user.id)) {
        throw new HttpError(409, 'You already have an active reservation for this book')
      }
      db.prepare(`
        INSERT INTO reservations (id, book_id, user_id, pickup_location_id, status, created_at)
        VALUES (?, ?, ?, COALESCE((SELECT id FROM locations WHERE id = ?), (SELECT location_id FROM books WHERE id = ?)), 'active', ?)
      `).run(reservationId, book.id, user.id, pickupLocationId ?? '', book.id, createdAt)
      return book.id
    })()
    const row = db.prepare(`
      SELECT r.id, r.status, r.created_at, r.cancelled_at, r.fulfilled_at, r.pickup_location_id,
        b.id AS book_id, b.title, b.author, b.catalog_code, l.id AS location_id, l.name AS location_name
      FROM reservations r JOIN books b ON b.id = r.book_id JOIN locations l ON l.id = b.location_id
      WHERE r.id = ?
    `).get(reservationId) as Record<string, unknown>
    res.status(201).json({ reservation: reservationFromRow(row), bookId: createReservation })
  })

  const cancelReservation = (req: Request, res: Response) => {
    const user = requireUser(req, res)
    if (!user) return
    const cancelledAt = nowIso()
    const result = db.prepare(`
      UPDATE reservations SET status = 'cancelled', cancelled_at = ?
      WHERE id = ? AND user_id = ? AND status = 'active'
    `).run(cancelledAt, req.params.reservationId, user.id)
    if (result.changes === 0) throw new HttpError(404, 'Active reservation not found')
    res.json({ ok: true, reservationId: req.params.reservationId, status: 'cancelled', cancelledAt })
  }
  app.post('/api/reservations/:reservationId/cancel', cancelReservation)
  app.delete('/api/reservations/:reservationId', cancelReservation)

  app.get('/api/loans', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const rows = db.prepare(`
      SELECT l.id, l.checked_out_at, l.due_at, l.returned_at, l.renewal_count, l.max_renewals,
        b.id AS book_id, b.title, b.author, b.catalog_code, loc.name AS location_name
      FROM loans l JOIN books b ON b.id = l.book_id JOIN locations loc ON loc.id = b.location_id
      WHERE l.user_id = ? ORDER BY l.returned_at IS NULL DESC, l.due_at ASC
    `).all(user.id) as Record<string, unknown>[]
    res.json({ loans: rows.map(loanFromRow) })
  })

  app.post('/api/loans', (req, res) => {
    const user = requireUser(req, res)
    if (!user) return
    const bookId = stringField(bodyOf(req).bookId, 'bookId', 100)
    const checkedOutAt = nowIso()
    const dueAt = addDays(checkedOutAt, DEFAULT_LOAN_DAYS)
    const loanId = randomUUID()
    const checkout = db.transaction(() => {
      const book = db.prepare('SELECT id FROM books WHERE id = ? OR catalog_code = ?').get(bookId, bookId) as { id: string } | undefined
      if (!book) throw new HttpError(404, 'Book not found')
      const activeLoan = db.prepare('SELECT id FROM loans WHERE book_id = ? AND returned_at IS NULL').get(book.id)
      if (activeLoan) throw new HttpError(409, 'This book is already on loan')
      const activeReservations = db.prepare(`
        SELECT id, user_id FROM reservations WHERE book_id = ? AND status = 'active' ORDER BY created_at
      `).all(book.id) as { id: string; user_id: string }[]
      const otherReservation = activeReservations.find((reservation) => reservation.user_id !== user.id)
      if (otherReservation) throw new HttpError(409, 'This book is reserved by another member')
      if (activeReservations[0]?.user_id === user.id) {
        db.prepare(`
          UPDATE reservations SET status = 'fulfilled', fulfilled_at = ? WHERE id = ?
        `).run(checkedOutAt, activeReservations[0].id)
      }
      db.prepare(`
        INSERT INTO loans (id, book_id, user_id, checked_out_at, due_at, renewal_count, max_renewals)
        VALUES (?, ?, ?, ?, ?, 0, 2)
      `).run(loanId, book.id, user.id, checkedOutAt, dueAt)
      return book.id
    })()
    const row = db.prepare(`
      SELECT l.id, l.checked_out_at, l.due_at, l.returned_at, l.renewal_count, l.max_renewals,
        b.id AS book_id, b.title, b.author, b.catalog_code, loc.name AS location_name
      FROM loans l JOIN books b ON b.id = l.book_id JOIN locations loc ON loc.id = b.location_id
      WHERE l.id = ?
    `).get(loanId) as Record<string, unknown>
    res.status(201).json({ loan: loanFromRow(row), bookId: checkout })
  })

  const returnLoan = (req: Request, res: Response) => {
    const user = requireUser(req, res)
    if (!user) return
    const returnedAt = nowIso()
    const result = db.prepare(`
      UPDATE loans SET returned_at = ?
      WHERE id = ? AND user_id = ? AND returned_at IS NULL
    `).run(returnedAt, req.params.loanId, user.id)
    if (result.changes === 0) throw new HttpError(404, 'Active loan not found')
    res.json({ ok: true, loanId: req.params.loanId, returnedAt })
  }
  app.post('/api/loans/:loanId/return', returnLoan)

  const renewLoan = (req: Request, res: Response) => {
    const user = requireUser(req, res)
    if (!user) return
    const row = db.prepare(`
      SELECT id, due_at, renewal_count, max_renewals, returned_at
      FROM loans WHERE id = ? AND user_id = ?
    `).get(req.params.loanId, user.id) as { id: string; due_at: string; renewal_count: number; max_renewals: number; returned_at: string | null } | undefined
    if (!row || row.returned_at) throw new HttpError(404, 'Active loan not found')
    if (row.renewal_count >= row.max_renewals) throw new HttpError(409, 'This loan has reached its renewal limit')
    const dueAt = addDays(new Date(Math.max(Date.now(), new Date(row.due_at).getTime())).toISOString(), DEFAULT_LOAN_DAYS)
    db.prepare(`
      UPDATE loans SET due_at = ?, renewal_count = renewal_count + 1 WHERE id = ?
    `).run(dueAt, row.id)
    res.json({ loanId: row.id, dueAt, renewalCount: row.renewal_count + 1, maxRenewals: row.max_renewals })
  }
  app.post('/api/loans/:loanId/renew', renewLoan)
  app.post('/api/loans/:loanId/renewal', renewLoan)

  const writeReview = (req: Request, res: Response) => {
    const user = requireUser(req, res)
    if (!user) return
    const body = bodyOf(req)
    const rating = Number(body.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'rating must be an integer from 1 to 5')
    const reviewBody = stringField(body.body, 'body', 2000)
    const book = db.prepare('SELECT id FROM books WHERE id = ? OR catalog_code = ?').get(req.params.bookId, req.params.bookId) as { id: string } | undefined
    if (!book) throw new HttpError(404, 'Book not found')
    const timestamp = nowIso()
    db.prepare(`
      INSERT INTO reviews (id, book_id, user_id, rating, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, user_id) DO UPDATE SET
        rating = excluded.rating, body = excluded.body, updated_at = excluded.updated_at
    `).run(randomUUID(), book.id, user.id, rating, reviewBody, timestamp, timestamp)
    const review = db.prepare(`
      SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, u.id AS user_id, u.name AS user_name
      FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.book_id = ? AND r.user_id = ?
    `).get(book.id, user.id) as Record<string, unknown>
    res.status(201).json({ review: {
      id: review.id,
      rating: review.rating,
      body: review.body,
      createdAt: review.created_at,
      updatedAt: review.updated_at,
      user: { id: review.user_id, name: review.user_name },
    } })
  }
  app.post('/api/catalog/:bookId/reviews', writeReview)
  app.put('/api/catalog/:bookId/reviews', writeReview)

  const distPath = path.resolve(process.cwd(), 'dist')
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath))
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(path.join(distPath, 'index.html'))
        return
      }
      next()
    })
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message })
      return
    }
    const code = (error as { code?: string } | null)?.code
    if (code?.startsWith('SQLITE_CONSTRAINT')) {
      res.status(409).json({ error: 'That operation conflicts with the current library state' })
      return
    }
    console.error(error)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
