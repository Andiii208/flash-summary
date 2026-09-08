import type BetterSqlite3 from 'better-sqlite3'
import { migration001 } from './migrations/001_initial'
import { migration002 } from './migrations/002_task_stage_outputs'
import { migration003 } from './migrations/003_providers'
import { migration004 } from './migrations/004_settings'
import { migration005 } from './migrations/005_error_kind'
import { migration006 } from './migrations/006_play_refs'
import { migration007 } from './migrations/007_course_meta'
import { migration008 } from './migrations/008_indexes'
import { migration009 } from './migrations/009_bilibili_source'
import { migration010 } from './migrations/010_obsidian_exports'
import type { Migration } from './migration-types'

const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial_schema', up: migration001.up },
  { version: 2, name: 'task_stage_outputs', up: migration002.up },
  { version: 3, name: 'providers', up: migration003.up },
  { version: 4, name: 'settings', up: migration004.up },
  { version: 5, name: 'error_kind', up: migration005.up },
  { version: 6, name: 'play_refs', up: migration006.up },
  { version: 7, name: 'course_meta', up: migration007.up },
  { version: 8, name: 'growth_indexes', up: migration008.up },
  { version: 9, name: 'bilibili_source', up: migration009.up },
  { version: 10, name: 'obsidian_exports', up: migration010.up }
]

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
