import Database from 'better-sqlite3'
import { migrate } from './migrate'

export type Db = Database.Database

/** Open (creating if needed) and migrate a library database. */
export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}
