import { existsSync, readdirSync, statSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { cachePath } from '../library/paths'

function dirSizeBytes(dir: string): number {
  let total = 0
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const current = stack.pop() ?? ''
    let entries: string[] = []
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry)
      try {
        const stats = statSync(full)
        if (stats.isDirectory()) stack.push(full)
        else total += stats.size
      } catch {
        // Vanishing mid-walk contributes 0.
      }
    }
  }
  return total
}

/**
 * Startup cleanup: remove cache entries older than 24h (spec §9), then
 * enforce the cache quota by evicting the oldest task dirs first (review
 * B5: failed tasks legitimately keep resumable artifacts, so without a
 * quota a run of failures piles up tens of GB). `cacheDir` is the effective
 * directory (user override respected, U3). Entries whose name matches a
 * running/queued task id are always kept (U4) — never delete a task's
 * in-flight cache by mtime alone.
 * Returns the deleted entry names for logging (names only, never URLs).
 */
export function cleanStaleCache(
  cacheDir: string,
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000,
  runningTaskIds: ReadonlySet<string> = new Set(),
  maxTotalBytes = Number.POSITIVE_INFINITY
): string[] {
  if (!existsSync(cacheDir)) return []
  const removed: string[] = []
  const survivors: Array<{ name: string; full: string; mtimeMs: number }> = []
  for (const entry of readdirSync(cacheDir)) {
    if (runningTaskIds.has(entry)) continue
    const full = join(cacheDir, entry)
    try {
      const stats = statSync(full)
      if (now - stats.mtimeMs > maxAgeMs) {
        rmSync(full, { recursive: true, force: true })
        removed.push(entry)
      } else {
        survivors.push({ name: entry, full, mtimeMs: stats.mtimeMs })
      }
    } catch {
      // A file disappearing mid-scan is not an error for cleanup purposes.
    }
  }
  if (Number.isFinite(maxTotalBytes)) {
    const sizeOf = new Map<string, number>()
    let total = 0
    for (const survivor of survivors) {
      const size = dirSizeBytes(survivor.full)
      sizeOf.set(survivor.name, size)
      total += size
    }
    // Evict oldest-first until under quota (running entries were excluded above).
    survivors.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const survivor of survivors) {
      if (total <= maxTotalBytes) break
      const size = sizeOf.get(survivor.name) ?? 0
      try {
        rmSync(survivor.full, { recursive: true, force: true })
      } catch {
        continue
      }
      total -= size
      removed.push(survivor.name)
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
