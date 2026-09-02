/**
 * Library migration (U3): move the library to a new directory.
 * Strategy: validate the target (non-empty rejects), copy db + attachments
 * via the SQLite backup API (WAL-consistent), and on any failure roll back
 * by removing what was written to the target. The source directory is never
 * written to, so it remains the intact fallback; the settings.libraryRoot
 * switch happens after a successful copy.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { Db } from '../db/open'
import { attachmentsPath } from './paths'

export type MigrationResult = { ok: true; dest: string } | { ok: false; error: string }

export async function migrateLibrary(db: Db, srcRoot: string, dest: string): Promise<MigrationResult> {
  try {
    const destTrimmed = dest.trim()
    if (destTrimmed === '') return { ok: false, error: '目标目录不能为空' }
    if (destTrimmed === srcRoot) return { ok: false, error: '目标目录与当前资料库相同' }
    if (existsSync(destTrimmed) && readdirSync(destTrimmed).length > 0) {
      return { ok: false, error: '目标目录非空，请选择空目录' }
    }
    mkdirSync(destTrimmed, { recursive: true })

    // Copy the live db via the SQLite backup API (WAL-consistent).
    await db.backup(join(destTrimmed, 'app.db'))
    // Copy attachments (videos/keyframes/ppt are all under attachments).
    cpSync(attachmentsPath(srcRoot), attachmentsPath(destTrimmed), { recursive: true })
    return { ok: true, dest: destTrimmed }
  } catch (e) {
    // Roll back: remove whatever partial copy landed in the target.
    try {
      rmSync(dest.trim(), { recursive: true, force: true })
    } catch {
      // Best-effort rollback; the error below is what the user should see.
    }
    return { ok: false, error: (e as Error).message }
  }
}
