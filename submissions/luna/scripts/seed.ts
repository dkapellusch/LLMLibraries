import { openDatabase } from '../server/db.js'
import { seedDatabase, seedConstants } from '../server/seed.js'

const db = openDatabase()
seedDatabase(db)

const bookCount = db.prepare('SELECT COUNT(*) AS count FROM books').get() as { count: number }
const locationCount = db.prepare('SELECT COUNT(*) AS count FROM locations').get() as { count: number }
console.log(`Seeded ${bookCount.count} books across ${locationCount.count} locations (target ${seedConstants.BOOK_COUNT}+).`)
db.close()
