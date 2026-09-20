/**
 * B1 (plan 2026-09-19-note-experience-overhaul): 归章——把时间线条目按 `at`
 * 分到各章。纯函数，renderer 与 PDF 共用同一判定。
 *
 * 设计口径：
 *   - 章按 `at` 排序后切分区间：[章K.at, 章K+1.at) 归章 K；首章之前的条目进
 *     **未分组桶**（旧笔记/模型漏开头的条目不丢）；
 *   - `chapters` 为空 → 单一未分组桶 = 旧渲染逐字不变（零回归的关键性质）；
 *   - 章区间内的条目按时间原序；组间顺序 = 章时间序；未分组桶恒在最前。
 */
import type { Chapter, TimelineEntry } from './schema'

export interface TimelineChapterGroup {
  /** null = 首章之前的未分组条目（无章可归）。 */
  chapter: Chapter | null
  entries: TimelineEntry[]
}

export function groupTimelineByChapters(entries: ReadonlyArray<TimelineEntry>, chapters: ReadonlyArray<Chapter>): TimelineChapterGroup[] {
  if (chapters.length === 0) return [{ chapter: null, entries: [...entries] }]
  const sorted = [...chapters].sort((a, b) => a.at - b.at)
  const buckets: TimelineChapterGroup[] = sorted.map((chapter) => ({ chapter, entries: [] }))
  const preamble: TimelineEntry[] = []
  for (const entry of entries) {
    let placed = false
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (entry.at >= sorted[i]!.at) {
        buckets[i]!.entries.push(entry)
        placed = true
        break
      }
    }
    if (!placed) preamble.push(entry)
  }
  const groups: TimelineChapterGroup[] = []
  if (preamble.length > 0) groups.push({ chapter: null, entries: preamble })
  for (const bucket of buckets) if (bucket.entries.length > 0) groups.push(bucket)
  // 空章不进阅读视图（空 section 纪律）；一章都没条目时整体退化为单一桶。
  return groups.length > 0 ? groups : [{ chapter: null, entries: [...entries] }]
}
