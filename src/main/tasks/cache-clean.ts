import { existsSync, readdirSync, statSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { attachmentsPath, cachePath } from '../library/paths'
import type { Db } from '../db/open'
import { BILI_STREAM_FRESH_MS, STREAM_URL_FRESH_MS } from './resume'

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

/**
 * 批6 修复轮 I1: 孤儿附件目录清扫。
 *
 * `cleanStaleCache` 只扫 `<cacheDir>/<taskId>`，从不碰 `attachments/`——而
 * removeCourse 的 rmSync 失败、迁移半途、崩溃都会在 `attachments/<lessonId>`
 * 留下「DB 已无 lessons 行」的孤儿目录（批6 主实现里「24h sweep 兜底」的注释
 * 此前是一句不实声明，这里把它变成真的）。判据两条同时满足才删：
 *   ① DB 无对应 lessons 行（级联删除后课程/课时行都没了才是孤儿）
 *   ② 目录 mtime > maxAgeMs（24h 内可能是刚落盘、库行稍后写入的竞态窗口）
 * `activeLessonIds`（在跑/排队任务的课时）一律排除——belt-and-braces：任务期
 * 附件先落盘、库行由导入事务先写，正常不会进判据，防御不做省。
 * 纯函数（db + 时间入参），返回删除的 lessonId 列表供日志（只有 id）。
 */
export function cleanOrphanAttachmentDirs(
  db: Db,
  libraryRoot: string,
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000,
  activeLessonIds: ReadonlySet<string> = new Set()
): string[] {
  const attachments = attachmentsPath(libraryRoot)
  if (!existsSync(attachments)) return []
  let lessonIds: ReadonlySet<string>
  try {
    const rows = db.prepare('SELECT id FROM lessons').all() as Array<{ id: string }>
    lessonIds = new Set(rows.map((r) => r.id))
  } catch {
    // 表缺失（旧库迁移中）→ 宁可不动，也不能凭目录名删证据。
    return []
  }
  const removed: string[] = []
  for (const entry of readdirSync(attachments)) {
    if (lessonIds.has(entry) || activeLessonIds.has(entry)) continue
    const full = join(attachments, entry)
    try {
      const stats = statSync(full)
      if (!stats.isDirectory()) continue
      if (now - stats.mtimeMs <= maxAgeMs) continue
      rmSync(full, { recursive: true, force: true })
      removed.push(entry)
    } catch {
      // A file disappearing mid-scan is not an error for cleanup purposes.
    }
  }
  return removed
}

/** 在跑/排队任务的课时 id（崩溃残留的非终态行也算——它们随时可能被续跑）。 */
export function activeLessonIds(db: Db): ReadonlySet<string> {
  try {
    const rows = db
      .prepare("SELECT DISTINCT lesson_id FROM tasks WHERE state NOT IN ('succeeded', 'failed')")
      .all() as Array<{ lesson_id: string }>
    return new Set(rows.map((r) => r.lesson_id))
  } catch {
    return new Set()
  }
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
/**
 * H2 (review): Windows Crashpad writes minidumps under userData that can
 * contain in-memory secrets — never uploaded (no crashReporter), but they
 * should not sit on disk forever. Sweep at startup, keep a week.
 */
export function cleanStaleCrashDumps(userDataDir: string, now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
  const reportsDir = join(userDataDir, 'Crashpad', 'reports')
  if (!existsSync(reportsDir)) return 0
  let removed = 0
  for (const entry of readdirSync(reportsDir)) {
    const full = join(reportsDir, entry)
    try {
      if (now - statSync(full).mtimeMs > maxAgeMs) {
        rmSync(full, { force: true })
        removed++
      }
    } catch {
      // Vanishing mid-scan is fine for a sweep.
    }
  }
  return removed
}

/**
 * 声明批7（plan 2026-09-11 compliance-disclosure）: 清扫**已过新鲜期**的签名直链交接。
 *
 * 背景：`task_stage_outputs` 的 fetching_course 行里存着**完整的限时签名直链**
 * （auth_key）——这是 app.db 里唯一明文落盘的敏感 URL。三条出路：
 *   · 成功 → `markSucceeded` 清除 ✅
 *   · 取消 → `cancelTask` 清除 ✅（批7 新增）
 *   · **失败 → 故意保留**，让断点续跑不必重新收割（续跑新鲜度见 resume.ts）
 *
 * 但「故意保留」不该是无限期：一旦超过 auth_key 的新鲜窗口，续跑本来就会重新收割
 * （`resolveResumeStage` 的降级判断用的就是这两个常量），那条明文 URL 已经没有任何
 * 用途，只剩风险。启动清扫时删掉它——**窗口按行自己的视频源取**，B 站流只活 120
 * 分钟，用 6 小时去衡量会把早已失效的 URL 多留几个钟头。
 *
 * 纯函数（只读 db + 时间入参），便于直接测试。
 */
export function pruneStaleSignedUrlHandoffs(
  db: Db,
  now = Date.now(),
  seuMaxAgeMs = STREAM_URL_FRESH_MS,
  biliMaxAgeMs = BILI_STREAM_FRESH_MS
): number {
  let rows: Array<{ task_id: string; output_json: string; updated_at: string | null }> = []
  try {
    rows = db
      .prepare(
        "SELECT s.task_id, s.output_json, t.updated_at FROM task_stage_outputs s LEFT JOIN tasks t ON s.task_id = t.id WHERE s.stage = 'fetching_course'"
      )
      .all() as typeof rows
  } catch {
    // A missing table (older library mid-migration) must not brick startup.
    return 0
  }
  const remove = db.prepare("DELETE FROM task_stage_outputs WHERE task_id = ? AND stage = 'fetching_course'")
  let removed = 0
  for (const row of rows) {
    const at = Date.parse(row.updated_at ?? '')
    // No timestamp to judge by → leave it alone; resume still reads it and
    // resolveResumeStage degrades on its own if the signature is dead.
    if (!Number.isFinite(at)) continue
    const isBilibili = row.output_json.includes('"bilibili":true')
    const age = now - at
    if (age > (isBilibili ? biliMaxAgeMs : seuMaxAgeMs)) {
      remove.run(row.task_id)
      removed++
    }
  }
  return removed
}
