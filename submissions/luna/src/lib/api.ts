import { demoBooks, demoLocations, demoLoans, demoReservations, demoUser, getDemoBook } from '../data/demo'
import type { AuthResponse, Book, CatalogResponse, LibraryUser, Loan, LocationAvailability, Reservation, Review } from '../types'

const API_BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? `Request failed with ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function coverTone(id: string): string {
  return ['sage', 'ink', 'ochre', 'plum', 'clay', 'blue'][[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6]
}

function uiLocation(raw: Record<string, unknown>): LocationAvailability {
  const total = Number(raw.bookCount ?? raw.total ?? 0)
  const available = Number(raw.availableCount ?? raw.available ?? 0)
  return {
    id: String(raw.id), name: String(raw.name), city: String(raw.city),
    address: String(raw.description ?? 'Private reading room'),
    hours: 'Open by appointment', available, total,
  }
}

function uiBook(raw: Record<string, any>, allLocations: LocationAvailability[] = []): Book {
  const location = raw.location ? uiLocation({ ...raw.location, bookCount: 1, availableCount: raw.available ? 1 : 0 }) : allLocations[0]
  const bookLocations = location ? [location] : allLocations
  const reviewCount = Number(raw.reviewCount ?? 0)
  const rating = raw.averageRating === null || raw.averageRating === undefined ? 0 : Number(raw.averageRating)
  return {
    id: String(raw.id), title: String(raw.title), author: String(raw.author), year: Number(raw.publicationYear ?? 0),
    genre: String(raw.genre), description: String(raw.description), coverTone: coverTone(String(raw.id)),
    isbn: String(raw.isbn ?? '—'), language: String(raw.language ?? 'English'), pages: Number(raw.pages ?? 0),
    rating, reviewCount, format: 'Fine copy', shelf: location ? `${location.name} · Private stack` : 'Private stack',
    copies: bookLocations.reduce((sum, item) => sum + item.total, 0) || 1,
    availableCopies: raw.available ? 1 : 0, locations: bookLocations, reviews: [],
  }
}

function uiReview(raw: Record<string, any>): Review {
  const name = String(raw.user?.name ?? 'Luna member')
  return { id: String(raw.id), author: name, initials: initials(name), rating: Number(raw.rating), date: new Date(String(raw.createdAt)).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), body: String(raw.body) }
}

function uiLoan(raw: Record<string, any>): Loan {
  const dueDate = String(raw.dueAt)
  const due = new Date(dueDate).getTime()
  const days = (due - Date.now()) / 86400000
  return { id: String(raw.id), bookId: String(raw.book?.id ?? raw.bookId), dueDate, borrowedAt: String(raw.checkedOutAt), renewalCount: Number(raw.renewalCount ?? 0), maxRenewals: Number(raw.maxRenewals ?? 2), status: days < 0 ? 'Overdue' : days < 5 ? 'Due soon' : 'On loan' }
}

function uiReservation(raw: Record<string, any>): Reservation {
  const requestedAt = String(raw.createdAt ?? raw.requestedAt)
  const expiry = new Date(requestedAt)
  expiry.setUTCDate(expiry.getUTCDate() + 14)
  return { id: String(raw.id), bookId: String(raw.book?.id ?? raw.bookId), requestedAt, expiresAt: String(raw.expiresAt ?? expiry.toISOString()), pickupLocationId: String(raw.pickupLocationId ?? ''), queuePosition: Number(raw.queuePosition ?? 1), status: raw.status === 'fulfilled' ? 'Checked out' : raw.status === 'ready' ? 'Ready for pickup' : 'Reserved' }
}

export async function getCatalog(filters: { query?: string; genre?: string; availableOnly?: boolean; locationId?: string } = {}): Promise<CatalogResponse> {
  const params = new URLSearchParams()
  if (filters.query) params.set('q', filters.query)
  if (filters.genre) params.set('genre', filters.genre)
  if (filters.availableOnly) params.set('available', 'true')
  if (filters.locationId) params.set('location', filters.locationId)
  try {
    const payload = await request<{ items: Record<string, any>[]; total: number }>(`/books${params.size ? `?${params}` : ''}`)
    return { books: payload.items.map((item) => uiBook(item)), total: payload.total }
  } catch {
    const query = filters.query?.trim().toLowerCase()
    const books = demoBooks.filter((book) => (!query || [book.title, book.author, book.genre, book.isbn].some((value) => value.toLowerCase().includes(query))) && (!filters.genre || book.genre === filters.genre) && (!filters.availableOnly || book.availableCopies > 0))
    return { books, total: books.length }
  }
}

export async function getBook(id: string): Promise<Book | undefined> {
  try {
    const payload = await request<{ book: Record<string, any>; reviews: Record<string, any>[] }>(`/books/${id}`)
    const book = uiBook(payload.book)
    book.reviews = payload.reviews.map(uiReview)
    book.reviewCount = book.reviews.length || book.reviewCount
    book.rating = book.reviews.length ? book.reviews.reduce((sum, review) => sum + review.rating, 0) / book.reviews.length : book.rating
    return book
  } catch {
    return getDemoBook(id)
  }
}

export async function getLocations(): Promise<LocationAvailability[]> {
  try {
    const payload = await request<{ locations: Record<string, unknown>[] }>('/locations')
    return payload.locations.map(uiLocation)
  } catch { return demoLocations }
}

export async function getLoans(): Promise<Loan[]> {
  try {
    const payload = await request<{ loans: Record<string, any>[] }>('/loans')
    return payload.loans.map(uiLoan)
  } catch { return demoLoans }
}

export async function getReservations(): Promise<Reservation[]> {
  try {
    const payload = await request<{ reservations: Record<string, any>[] }>('/reservations')
    return payload.reservations.map(uiReservation)
  } catch { return demoReservations }
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  try {
    const response = await request<{ user: { id: string; name: string; email: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    const user = response.user
    return { user: { id: user.id, name: user.name, email: user.email, initials: initials(user.name), defaultLocationId: 'location-luna-house' } }
  } catch (error) {
    if (email !== demoUser.email || password.length < 6) throw error
    return { user: demoUser }
  }
}

export async function logout(): Promise<void> {
  await request<void>('/auth/logout', { method: 'POST' })
}

export async function renewLoan(loanId: string, current?: Loan): Promise<Loan> {
  try {
    const response = await request<{ loanId: string; dueAt: string; renewalCount: number; maxRenewals: number }>(`/loans/${loanId}/renew`, { method: 'POST' })
    const base = current ?? demoLoans.find((loan) => loan.id === loanId)
    if (!base) throw new Error('Loan not found')
    return { ...base, dueDate: response.dueAt, renewalCount: response.renewalCount, maxRenewals: response.maxRenewals, status: 'On loan' }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    const loan = current ?? demoLoans.find((item) => item.id === loanId)
    if (!loan) throw error
    return { ...loan, dueDate: '2026-10-23', renewalCount: Math.min(loan.renewalCount + 1, loan.maxRenewals), status: 'On loan' }
  }
}

export async function createReservation(bookId: string, locationId: string): Promise<Reservation> {
  try {
    const response = await request<{ reservation: Record<string, any> }>('/reservations', { method: 'POST', body: JSON.stringify({ bookId, pickupLocationId: locationId }) })
    return uiReservation(response.reservation)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return { id: `reservation-${Date.now()}`, bookId, requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(), pickupLocationId: locationId, queuePosition: 1, status: 'Reserved' }
  }
}

export function getStoredUser(): LibraryUser | null {
  try { const raw = localStorage.getItem('luna-user'); return raw ? JSON.parse(raw) as LibraryUser : null } catch { return null }
}

export function storeUser(user: LibraryUser | null): void {
  if (user) localStorage.setItem('luna-user', JSON.stringify(user))
  else localStorage.removeItem('luna-user')
}
