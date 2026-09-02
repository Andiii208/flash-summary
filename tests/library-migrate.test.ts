import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { migrateLibrary } from '../src/main/library/migrate'
import { attachmentsPath } from '../src/main/library/paths'

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
})
