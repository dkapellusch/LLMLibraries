import type { Book, LibraryUser, Loan, LocationAvailability, Reservation } from '../types'

// The application is backed by the seeded SQLite catalog. These values only keep
// the shell predictable while a local server is coming up; no books are fabricated.
export const demoUser: LibraryUser = {
  id: 'user-alex-morgan',
  name: 'Alex Morgan',
  email: 'alex@lunalibrary.test',
  initials: 'AM',
  defaultLocationId: 'location-luna-house',
}

export const demoLocations: LocationAvailability[] = [
  { id: 'location-luna-house', name: 'Luna House', city: 'Edinburgh', address: 'Reading rooms and public collection', hours: 'Open by appointment', available: 0, total: 0 },
  { id: 'location-north-stack', name: 'North Stack', city: 'Copenhagen', address: 'Modern literature and artists’ books', hours: 'Open by appointment', available: 0, total: 0 },
  { id: 'location-river-room', name: 'River Room', city: 'Paris', address: 'Translation and correspondence', hours: 'Open by appointment', available: 0, total: 0 },
  { id: 'location-archive', name: 'The Archive', city: 'Oxford', address: 'Fragile and early printed works', hours: 'Open by appointment', available: 0, total: 0 },
]

export const demoBooks: Book[] = []
export const demoLoans: Loan[] = []
export const demoReservations: Reservation[] = []
export function getDemoBook(_id: string): Book | undefined { return undefined }
