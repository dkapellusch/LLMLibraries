import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedDatabase, borrowOrQueue, returnLoan, hashPassword, verifyPassword } from '../src/db.js';
import { startServer } from '../server.js';

test('seed creates a complete multi-house catalogue', () => {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM books').get().n, 5400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM copies').get().n, 6000);
  assert.equal(db.prepare('SELECT count(*) AS n FROM locations').get().n, 4);
  assert.ok(db.prepare('SELECT count(*) AS n FROM books WHERE length(description) > 40').get().n >= 5400);
  db.close();
});

test('passwords are salted and verified without storing plaintext', () => {
  const first = hashPassword('a quiet password');
  const second = hashPassword('a quiet password');
  assert.notEqual(first, second);
  assert.equal(verifyPassword('a quiet password', first), true);
  assert.equal(verifyPassword('wrong password', first), false);
});

test('returning a volume promotes the first waiting member', () => {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  const bookId = 2;
  const copy = db.prepare('SELECT id FROM copies WHERE book_id=?').get(bookId);
  const addMember = db.prepare('INSERT INTO members(name,email,password_hash) VALUES(?,?,?)');
  const a = Number(addMember.run('First Reader', 'first@example.test', hashPassword('password-one')).lastInsertRowid);
  const b = Number(addMember.run('Second Reader', 'second@example.test', hashPassword('password-two')).lastInsertRowid);
  const borrowed = borrowOrQueue(db, a, bookId);
  const queued = borrowOrQueue(db, b, bookId);
  assert.equal(borrowed.kind, 'loan');
  assert.equal(queued.kind, 'queue');
  assert.equal(queued.position, 1);
  assert.deepEqual(returnLoan(db, a, borrowed.id), { promoted: true });
  const promoted = db.prepare('SELECT * FROM loans WHERE copy_id=? AND member_id=? AND returned_at IS NULL').get(copy.id, b);
  assert.ok(promoted);
  assert.equal(db.prepare('SELECT status FROM reservations WHERE id=?').get(queued.id).status, 'fulfilled');
  db.close();
});

test('HTTP API supports registration, search, borrowing, review, renewal, and return', async (t) => {
  const db = openDatabase(':memory:');
  const { server } = startServer({ db });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); db.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  const call = async (path, options = {}) => {
    const response = await fetch(origin + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    return { response, data: await response.json() };
  };

  const bootstrap = await call('/api/bootstrap');
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.data.stats.titles, 5400);

  const registration = await call('/api/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Mina Shore', email: 'mina@example.test', password: 'long-enough-password' })
  });
  assert.equal(registration.response.status, 201);
  const session = registration.response.headers.get('set-cookie').split(';')[0];

  const search = await call('/api/books?q=Invisible%20Cities');
  assert.equal(search.data.total, 1);
  const bookId = search.data.books[0].id;

  const loan = await call(`/api/books/${bookId}/reserve`, { method: 'POST', body: '{}', headers: { cookie: session } });
  assert.equal(loan.response.status, 201);
  assert.equal(loan.data.kind, 'loan');

  const review = await call(`/api/books/${bookId}/reviews`, {
    method: 'POST', headers: { cookie: session }, body: JSON.stringify({ rating: 5, body: 'Precise, strange, and endlessly rereadable.' })
  });
  assert.equal(review.response.status, 201);

  const renewal = await call(`/api/loans/${loan.data.id}/renew`, { method: 'POST', body: '{}', headers: { cookie: session } });
  assert.equal(renewal.response.status, 200);

  const account = await call('/api/account', { headers: { cookie: session } });
  assert.equal(account.data.loans.length, 1);
  assert.equal(account.data.loans[0].renewals, 1);

  const returned = await call(`/api/loans/${loan.data.id}/return`, { method: 'POST', body: '{}', headers: { cookie: session } });
  assert.equal(returned.response.status, 200);
  const finalAccount = await call('/api/account', { headers: { cookie: session } });
  assert.equal(finalAccount.data.loans.length, 0);
  assert.equal(finalAccount.data.history.length, 1);
});
