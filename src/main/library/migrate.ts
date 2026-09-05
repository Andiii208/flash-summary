/**
 * Library migration (U3, reworked 2026-09-05 review C1-C3).
 *
 * Strategy: validate the target (non-empty rejects), copy db + attachments
 * via the SQLite backup API (WAL-consistent), rewrite stored attachment
 * paths from absolute to library-relative in the NEW db (so the db is
 * location-independent), and roll back on any failure by removing what was
 * written to the target. The source directory is never written to.
 *
 * The old libraryRoot pointer was written into the OLD library's settings
 * table where no startup code ever read it back — the caller now records
 * the destination in the userData bootstrap pointer (library/pointer.ts).
 * Attachment copying runs per top-level entry with progress callbacks
 * instead of one blocking cpSync, and the caller refuses to migrate while
 * any task is running or queued.
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { cp, readdir } from 'fs/promises'
import { isAbsolute, join } from 'path'
import type { Db } from '../db/open'
import { attachmentsPath } from './paths'

export type MigrationResult = { ok: true; dest: string } | { ok: false; error: string }

export interface MigrateOptions {
  /** Per-entry copy progress (entries are attachment subdirectories). */
  onProgress?: (copied: number, total: number) => void
}

/**
 * Rewrite keyframes/ppt_pages file_path rows from absolute (legacy) to
 * library-relative in the copied db, so evidence keeps resolving after the
 * root moves. Rows outside srcRoot are left untouched (absolute paths keep
 * working via the isAbsolute branch of resolveLibraryPath).
 */
export function relativizeAttachmentPaths(db: Db, srcRoot: string): { keyframes: number; pptPages: number } {
  // A missing table contributes zero (fresh/partial dbs must not break the move).
  const rewrite = (table: string): number => {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) == null) return 0
    const rows = db.prepare(`SELECT rowid, file_path FROM ${table}`).all() as Array<{ rowid: number; file_path: string }>
    let updated = 0
    const update = db.prepare(`UPDATE ${table} SET file_path = ? WHERE rowid = ?`)
    for (const row of rows) {
      if (!isAbsolute(row.file_path)) continue
      const normalizedSrc = srcRoot.endsWith('\\') || srcRoot.endsWith('/') ? srcRoot : srcRoot + '\\'
      if (!row.file_path.toLowerCase().startsWith(normalizedSrc.toLowerCase())) continue
      update.run(row.file_path.slice(normalizedSrc.length), row.rowid)
      updated++
    }
    return updated
  }
  const keyframes = rewrite('keyframes')
  const pptPages = rewrite('ppt_pages')
  return { keyframes, pptPages }
}

export async function migrateLibrary(db: Db, srcRoot: string, dest: string, options: MigrateOptions = {}): Promise<MigrationResult> {
  try {
    const destTrimmed = dest.trim()
    if (destTrimmed === '') return { ok: false, error: '目标目录不能为空' }
    if (destTrimmed === srcRoot) return { ok: false, error: '目标目录与当前资料库相同' }
    if (!existsSync(srcRoot)) return { ok: false, error: '当前资料库目录不存在，无法迁移' }
    if (existsSync(destTrimmed) && readdirSync(destTrimmed).length > 0) {
      return { ok: false, error: '目标目录非空，请选择空目录' }
    }
    mkdirSync(destTrimmed, { recursive: true })

    // Copy the live db via the SQLite backup API (WAL-consistent).
    await db.backup(join(destTrimmed, 'app.db'))

    // Rewrite absolute attachment paths to library-relative in the NEW db
    // (review C2: the db must survive the move with its evidence intact).
    const copiedDb = new Database(join(destTrimmed, 'app.db'))
    try {
      relativizeAttachmentPaths(copiedDb, srcRoot)
    } finally {
      copiedDb.close()
    }

    // Copy attachments per top-level entry with progress (review C3).
    const srcAttachments = attachmentsPath(srcRoot)
    const destAttachments = attachmentsPath(destTrimmed)
    if (existsSync(srcAttachments)) {
      const entries = (await readdir(srcAttachments, { withFileTypes: true })).map((e) => e.name)
      let copied = 0
      options.onProgress?.(0, entries.length)
      for (const entry of entries) {
        await cp(join(srcAttachments, entry), join(destAttachments, entry), { recursive: true })
        copied++
        options.onProgress?.(copied, entries.length)
      }
    }
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
