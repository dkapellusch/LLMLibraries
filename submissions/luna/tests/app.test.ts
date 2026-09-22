import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { seedDatabase } from '../server/seed.js'

const openServers: Array<{ close: (callback?: (error?: Error) => void) => void }> = []

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function testServer() {
  const db = openDatabase(':memory:')
  seedDatabase(db)
  const server = createApp({ db }).listen(0)
  openServers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind')
  return { base: `http://127.0.0.1:${address.port}`, db }
}

describe('Library Luna API', () => {
  it('seeds a real 5k+ catalog and searches it', async () => {
    const { base } = await testServer()
    const health = await fetch(`${base}/api/health`).then((response) => response.json()) as { books: number }
    expect(health.books).toBeGreaterThanOrEqual(5000)

    const search = await fetch(`${base}/api/books?q=pride%20and%20prejudice&pageSize=5`).then((response) => response.json()) as { total: number; items: Array<{ title: string; author: string; sourceUrl: string }> }
    expect(search.total).toBeGreaterThan(0)
    expect(search.items[0].title.toLowerCase()).toContain('pride')
    expect(search.items[0].author).toContain('Austen')
    expect(search.items[0].sourceUrl).toContain('openlibrary.org')
  })

  it('authenticates a member and supports reservations and renewals', async () => {
    const { base } = await testServer()
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alex@lunalibrary.test', password: 'luna-demo' }) })
    expect(login.ok).toBe(true)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toBeTruthy()

    const reservationResponse = await fetch(`${base}/api/reservations`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie! }, body: JSON.stringify({ bookId: 'book-00001', pickupLocationId: 'location-archive' }) })
    expect(reservationResponse.status).toBe(201)
    const reservation = await reservationResponse.json() as { reservation: { pickupLocationId: string } }
    expect(reservation.reservation.pickupLocationId).toBe('location-archive')

    const renewal = await fetch(`${base}/api/loans/loan-demo-alex/renew`, { method: 'POST', headers: { cookie: cookie! } })
    expect(renewal.ok).toBe(true)
    expect((await renewal.json()).renewalCount).toBe(2)
  })
})
