import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { initializeSchema } from './schema.js'

export type LibraryDatabase = Database.Database

export function openDatabase(filename = process.env.LIBRARY_DB_PATH ?? path.resolve(process.cwd(), 'data/library.sqlite')): LibraryDatabase {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true })
  }

  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  initializeSchema(db)
  return db
}
