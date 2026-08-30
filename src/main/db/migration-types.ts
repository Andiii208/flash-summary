import type BetterSqlite3 from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: (db: BetterSqlite3.Database) => void
}
