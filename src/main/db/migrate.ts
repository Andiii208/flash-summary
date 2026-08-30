import type BetterSqlite3 from 'better-sqlite3'
import { migration001 } from './migrations/001_initial'
import type { Migration } from './migration-types'

const MIGRATIONS: Migration[] = [{ version: 1, name: 'initial_schema', up: migration001.up }]

/**
 * Apply pending migrations inside a transaction, in order.
 * The `schema_migrations` table records applied versions.
 */
export function migrate(db: BetterSqlite3.Database): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>
  const applied = new Set(appliedRows.map((r) => r.version))

  let count = 0
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString()
      )
    })()
    count += 1
  }
  return count
}

export function appliedVersions(db: BetterSqlite3.Database): number[] {
  return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>).map(
    (r) => r.version
  )
}
