import { createApp } from './server/app.js'
import { openDatabase } from './server/db.js'
import { seedDatabase } from './server/seed.js'

const port = Number(process.env.PORT ?? 3000)
const db = openDatabase()
const books = db.prepare('SELECT COUNT(*) AS count FROM books').get() as { count: number }
if (books.count === 0) seedDatabase(db)
const app = createApp({ db })

app.listen(port, () => {
  console.log(`Library Luna API listening on http://localhost:${port}`)
})
