export type View = 'catalog' | 'library' | 'locations'

export type BookFormat = 'First edition' | 'Signed copy' | 'Limited edition' | 'Fine copy'

export interface LocationAvailability {
  id: string
  name: string
  city: string
  address: string
  hours: string
  available: number
  total: number
  distance?: string
}

export interface Review {
  id: string
  author: string
  initials: string
  rating: number
  date: string
  body: string
}

export interface Book {
  id: string
  title: string
  author: string
  year: number
  genre: string
  description: string
  coverTone: string
  isbn: string
  language: string
  pages: number
  rating: number
  reviewCount: number
  format: BookFormat
  shelf: string
  copies: number
  availableCopies: number
  locations: LocationAvailability[]
  reviews: Review[]
}

export interface Loan {
  id: string
  bookId: string
  dueDate: string
  borrowedAt: string
  renewalCount: number
  maxRenewals: number
  status: 'On loan' | 'Due soon' | 'Overdue'
}

export interface Reservation {
  id: string
  bookId: string
  requestedAt: string
  expiresAt: string
  pickupLocationId: string
  queuePosition: number
  status: 'Ready for pickup' | 'Reserved' | 'Checked out'
}

export interface LibraryUser {
  id: string
  name: string
  email: string
  initials: string
  defaultLocationId: string
}

export interface CatalogResponse {
  books: Book[]
  total: number
}

export interface AuthResponse {
  user: LibraryUser
  token?: string
}
