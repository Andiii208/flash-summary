import { existsSync, readdirSync, statSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { cachePath } from '../library/paths'

/**
 * Startup cleanup: remove cache entries older than 24h (spec §9).
 * `cacheDir` is the effective directory (user override respected, U3).
 * Returns the deleted entry names for logging (names only, never URLs).
 */
export function cleanStaleCache(cacheDir: string, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000): string[] {
  if (!existsSync(cacheDir)) return []
  const removed: string[] = []
  for (const entry of readdirSync(cacheDir)) {
    const full = join(cacheDir, entry)
    try {
      const stats = statSync(full)
      if (now - stats.mtimeMs > maxAgeMs) {
        rmSync(full, { recursive: true, force: true })
        removed.push(entry)
      }
    } catch {
      // A file disappearing mid-scan is not an error for cleanup purposes.
    }
  }
  return removed
}

/** Create a fake "old" cache entry for reverse verification in tests. */
export function seedCacheEntry(libraryRoot: string, name: string, mtimeMs: number, files: Record<string, string> = {}): string {
  const cache = cachePath(libraryRoot)
  mkdirSync(cache, { recursive: true })
  const dir = join(cache, name)
  mkdirSync(dir, { recursive: true })
  for (const [fileName, content] of Object.entries(files)) {
    const p = join(dir, fileName)
    writeFileSync(p, content)
    utimesSync(p, mtimeMs / 1000, mtimeMs / 1000)
  }
  return dir
}
