import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, utimesSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ensureLibraryLayout } from '../src/main/library/paths'
import { cleanStaleCache } from '../src/main/tasks/cache-clean'

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

    const removed = cleanStaleCache(root)
    expect(removed).toEqual(['task-old'])
    expect(existsSync(oldDir)).toBe(false)
    expect(existsSync(freshDir)).toBe(true)
    expect(readdirSync(cache)).toEqual(['task-fresh'])

    rmSync(root, { recursive: true, force: true })
  })

  it('is a no-op on an empty or missing cache dir', () => {
    const root = makeLibrary()
    rmSync(join(root, 'cache'), { recursive: true, force: true })
    expect(cleanStaleCache(root)).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })
})
