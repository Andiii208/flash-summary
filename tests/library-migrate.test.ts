import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import Database from 'better-sqlite3'
import { migrateLibrary, relativizeAttachmentPaths } from '../src/main/library/migrate'
import { attachmentsPath, resolveLibraryPath } from '../src/main/library/paths'

let src: string
let db: Db

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'seu-summary-migrate-'))
  src = join(base, 'src')
  mkdirSync(attachmentsPath(src), { recursive: true })
  writeFileSync(join(attachmentsPath(src), 'asset.bin'), 'data')
  db = openDatabase(join(src, 'app.db'))
})

afterEach(() => {
  db.close()
  rmSync(src, { recursive: true, force: true })
})

describe('migrateLibrary (U3)', () => {
  it('copies db + attachments to the target and leaves the source untouched', async () => {
    const dest = join(src, '..', 'dest')
    const result = await migrateLibrary(db, src, dest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(existsSync(join(dest, 'app.db'))).toBe(true)
    expect(existsSync(join(dest, 'attachments', 'asset.bin'))).toBe(true)
    // The source is never written to — it IS the fallback, no snapshot needed.
    // 批6 (D4): 迁移不产 .bak 快照；要「另存一份」走设置页的独立备份入口
    // （settings:exportLibraryBackup，db.backup 到用户自选路径）。
    const backups = readdirSync(src).filter((f) => f.startsWith('app.db.bak-'))
    expect(backups).toHaveLength(0)
    expect(existsSync(join(src, 'app.db'))).toBe(true)
  })

  it('rejects a non-empty target directory', async () => {
    const dest = join(src, '..', 'dest-nonempty')
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'occupied'), 'x')
    const result = await migrateLibrary(db, src, dest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('非空')
  })

  it('rejects a target equal to the source', async () => {
    const result = await migrateLibrary(db, src, src)
    expect(result.ok).toBe(false)
  })

  it('rolls back partial copies when the source is missing (failed migration)', async () => {
    const missingSrc = join(src, '..', 'gone')
    const dest = join(src, '..', 'dest-rollback')
    const result = await migrateLibrary(db, missingSrc, dest)
    expect(result.ok).toBe(false)
    expect(existsSync(dest)).toBe(false)
  })

  it('rewrites absolute attachment paths to library-relative in the new db (review C2)', async () => {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-01T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第1讲', '2026-09-01T00:00:00Z')").run()
    db.prepare("INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES ('k1', 'l1', 12, ?, 'h', '2026-09-01T00:00:00Z')").run(
      join(attachmentsPath(src), 'l1', 'kf.jpg')
    )
    const dest = join(src, '..', 'dest-rel')
    const result = await migrateLibrary(db, src, dest)
    expect(result.ok).toBe(true)
    const copied = new Database(join(dest, 'app.db'))
    try {
      const row = copied.prepare('SELECT file_path FROM keyframes WHERE id = ?').get('k1') as { file_path: string }
      // Relative now — the row survives any future move of the library.
      expect(row.file_path).toBe(join('attachments', 'l1', 'kf.jpg'))
      // And it resolves against the new root.
      expect(resolveLibraryPath(dest, row.file_path)).toBe(join(dest, 'attachments', 'l1', 'kf.jpg'))
    } finally {
      copied.close()
    }
  })

  it('leaves absolute paths outside the source root untouched (relativize)', () => {
    const testDb = new Database(':memory:')
    try {
      testDb.exec('CREATE TABLE keyframes (rowid INTEGER PRIMARY KEY, file_path TEXT)')
      testDb.prepare('INSERT INTO keyframes (rowid, file_path) VALUES (1, ?)').run('D:\\Elsewhere\\kf.jpg')
      relativizeAttachmentPaths(testDb, src)
      const row = testDb.prepare('SELECT file_path FROM keyframes WHERE rowid = 1').get() as { file_path: string }
      expect(row.file_path).toBe('D:\\Elsewhere\\kf.jpg')
    } finally {
      testDb.close()
    }
  })

  it('reports per-entry copy progress (review C3)', async () => {
    for (const lessonId of ['l1', 'l2', 'l3']) {
      const lessonDir = join(attachmentsPath(src), lessonId)
      mkdirSync(lessonDir, { recursive: true })
      writeFileSync(join(lessonDir, 'kf.jpg'), 'x')
    }
    // The flat asset.bin from beforeEach makes a 4th top-level entry.
    const dest = join(src, '..', 'dest-progress')
    const progress: Array<{ copied: number; total: number }> = []
    const result = await migrateLibrary(db, src, dest, { onProgress: (copied, total) => progress.push({ copied, total }) })
    expect(result.ok).toBe(true)
    expect(progress[0]).toEqual({ copied: 0, total: 4 })
    expect(progress[progress.length - 1]).toEqual({ copied: 4, total: 4 })
  })
})
