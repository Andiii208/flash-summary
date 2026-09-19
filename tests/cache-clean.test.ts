import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, utimesSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ensureLibraryLayout, attachmentsPath } from '../src/main/library/paths'
import { openDatabase, type Db } from '../src/main/db/open'
import { cleanStaleCache, cleanOrphanAttachmentDirs } from '../src/main/tasks/cache-clean'
import { createContext } from '../src/main/app-context'
import type { Cryptor } from '../src/main/auth/session-crypto'

function makeLibrary(): string {
  const root = mkdtempSync(join(tmpdir(), 'seu-summary-clean-'))
  ensureLibraryLayout(root)
  return root
}

describe('stale cache cleanup (reverse-verified)', () => {
  it('deletes entries older than 24h and keeps fresh ones', () => {
    const root = makeLibrary()
    const cache = join(root, 'cache')

    const oldDir = join(cache, 'task-old')
    const oldFile = join(oldDir, 'video.mp4')
    mkdirSync(oldDir, { recursive: true })
    writeFileSync(oldFile, 'old video bytes')
    // Backdate beyond the 24h window. On Windows the directory mtime does not
    // track its children, so stamp the directory entry itself.
    const oldTime = Date.now() - 25 * 60 * 60 * 1000
    utimesSync(oldFile, oldTime / 1000, oldTime / 1000)
    utimesSync(oldDir, oldTime / 1000, oldTime / 1000)

    const freshDir = join(cache, 'task-fresh')
    const freshFile = join(freshDir, 'video.mp4')
    mkdirSync(freshDir, { recursive: true })
    writeFileSync(freshFile, 'fresh video bytes')

    const removed = cleanStaleCache(cache)
    expect(removed).toEqual(['task-old'])
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(freshDir)).toBe(true)
    expect(readdirSync(cache)).toEqual(['task-fresh'])

    rmSync(root, { recursive: true, force: true })
  })

  it('is a no-op on an empty or missing cache dir', () => {
    const root = makeLibrary()
    const cache = join(root, 'cache')
    rmSync(cache, { recursive: true, force: true })
    expect(cleanStaleCache(cache)).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })

  it('enforces the quota by evicting the oldest task dirs first (review B5)', () => {
    const root = makeLibrary()
    const cache = join(root, 'cache')
    const now = Date.now()
    // Three fresh task dirs of ~10 bytes each; quota fits only two.
    for (const name of ['task-a', 'task-b', 'task-c']) {
      const taskDir = join(cache, name)
      mkdirSync(taskDir, { recursive: true })
      writeFileSync(join(taskDir, 'audio.wav'), 'x'.repeat(10))
    }
    // task-a is the oldest.
    utimesSync(join(cache, 'task-a'), (now - 60_000) / 1000, (now - 60_000) / 1000)
    const removed = cleanStaleCache(cache, now, 24 * 60 * 60 * 1000, new Set(), 25)
    expect(removed).toEqual(['task-a'])
    expect(existsSync(join(cache, 'task-a'))).toBe(false)
    expect(existsSync(join(cache, 'task-b'))).toBe(true)
    expect(existsSync(join(cache, 'task-c'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it('never evicts a running task dir even over quota (review B5)', () => {
    const root = makeLibrary()
    const cache = join(root, 'cache')
    const now = Date.now()
    const runningDir = join(cache, 'task-running')
    mkdirSync(runningDir, { recursive: true })
    writeFileSync(join(runningDir, 'audio.wav'), 'x'.repeat(50))
    const removed = cleanStaleCache(cache, now, 24 * 60 * 60 * 1000, new Set(['task-running']), 10)
    expect(removed).toEqual([])
    expect(existsSync(runningDir)).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })
})

/**
 * 批6 修复轮 I1: removeCourse 的 rmSync 失败、迁移半途、崩溃都会在
 * attachments/<lessonId> 留下「DB 已无 lessons 行」的孤儿目录——cleanStaleCache
 * 只扫 <cacheDir>/<taskId>，此前没有任何东西扫附件目录，「24h sweep 兜底」
 * 是一句不实声明。这里把兜底做成真的。
 */
describe('orphan attachment dirs sweep (批6 fix I1)', () => {
  const stubCryptor: Cryptor = {
    isAvailable: () => true,
    encryptString: (plain) => Buffer.from(plain),
    decryptString: (buf) => buf.toString('utf8')
  }

  function makeDbLibrary(): { db: Db; root: string } {
    const root = mkdtempSync(join(tmpdir(), 'seu-summary-att-gc-'))
    ensureLibraryLayout(root)
    return { db: openDatabase(join(root, 'app.db')), root }
  }

  function seedLesson(db: Db, id: string): void {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES (?, 'c1', '课时', '')").run(id)
  }

  function seedAttachmentDir(root: string, lessonId: string, mtimeMs: number): string {
    const dir = join(attachmentsPath(root), lessonId)
    mkdirSync(join(dir, 'keyframes'), { recursive: true })
    const file = join(dir, 'keyframes', 'kf-0000-0s.jpg')
    writeFileSync(file, 'frame')
    const old = mtimeMs / 1000
    utimesSync(file, old, old)
    utimesSync(dir, old, old)
    return dir
  }

  it('removes an orphan dir (no lessons row, older than 24h) and reports the lesson id', () => {
    const { db, root } = makeDbLibrary()
    const now = Date.now()
    const orphan = seedAttachmentDir(root, 'gone-lesson', now - 25 * 60 * 60 * 1000)

    expect(cleanOrphanAttachmentDirs(db, root, now)).toEqual(['gone-lesson'])
    expect(existsSync(orphan)).toBe(false)
    expect(readdirSync(attachmentsPath(root))).toEqual([])
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps a fresh orphan dir — a lesson row can still be written right after the files land (race window)', () => {
    const { db, root } = makeDbLibrary()
    const now = Date.now()
    const fresh = seedAttachmentDir(root, 'just-landed', now - 60 * 60 * 1000)

    expect(cleanOrphanAttachmentDirs(db, root, now)).toEqual([])
    expect(existsSync(fresh)).toBe(true)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps a dir whose lessons row exists — old evidence of a live lesson is content, not garbage', () => {
    const { db, root } = makeDbLibrary()
    const now = Date.now()
    seedLesson(db, 'live-lesson')
    const dir = seedAttachmentDir(root, 'live-lesson', now - 30 * 24 * 60 * 60 * 1000)

    expect(cleanOrphanAttachmentDirs(db, root, now)).toEqual([])
    expect(existsSync(dir)).toBe(true)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('never touches an active (running/queued) task\'s lesson dir even without a row (belt-and-braces)', () => {
    const { db, root } = makeDbLibrary()
    const now = Date.now()
    const dir = seedAttachmentDir(root, 'in-flight-lesson', now - 48 * 60 * 60 * 1000)

    expect(cleanOrphanAttachmentDirs(db, root, now, 24 * 60 * 60 * 1000, new Set(['in-flight-lesson']))).toEqual([])
    expect(existsSync(dir)).toBe(true)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('is a no-op when the attachments dir is missing', () => {
    const { db, root } = makeDbLibrary()
    rmSync(attachmentsPath(root), { recursive: true, force: true })
    expect(cleanOrphanAttachmentDirs(db, root)).toEqual([])
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('启动接线生效：走真实 createContext 之后，孤儿附件目录已经不在了', () => {
    // 与签名直链清扫同款纪律：测的不是函数而是它真的挂在启动路径上。
    const root = mkdtempSync(join(tmpdir(), 'seu-summary-att-gc-boot-'))
    const opts = { libraryRoot: root, userDataDir: join(root, 'userdata'), cryptor: stubCryptor }
    const first = createContext(opts)
    seedAttachmentDir(root, 'orphan-boot', Date.now() - 25 * 60 * 60 * 1000)
    seedAttachmentDir(root, 'fresh-boot', Date.now())
    expect(existsSync(join(attachmentsPath(root), 'orphan-boot'))).toBe(true)
    first.db.close()

    const second = createContext(opts)
    expect(existsSync(join(attachmentsPath(root), 'orphan-boot'))).toBe(false)
    expect(existsSync(join(attachmentsPath(root), 'fresh-boot'))).toBe(true)
    second.db.close()
    rmSync(root, { recursive: true, force: true })
  })
})
