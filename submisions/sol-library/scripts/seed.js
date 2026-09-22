import { openDatabase, seedDatabase } from '../src/db.js';

const db = openDatabase();
seedDatabase(db);
const books = db.prepare('SELECT count(*) AS n FROM books').get().n;
const copies = db.prepare('SELECT count(*) AS n FROM copies').get().n;
console.log(`Sol Library is ready: ${books.toLocaleString()} titles, ${copies.toLocaleString()} physical volumes.`);
db.close();
