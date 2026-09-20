/**
 * C5 (plan 2026-09-19-note-experience-overhaul): 图集按章节分组的横向胶片条。
 *
 * 纯函数：把帧按 `at` 落进章节区间（复用与时间线归章一致的区间口径），
 * 首章之前的帧进「未分组」桶。章节为空时调用方走原网格（零回归）。
 */
import type { Chapter } from './schema'

export interface FrameLike {
  ref: string
  at: number | null
}

export interface ChapterFrameGroup {
  /** null = 首章之前/无时间的帧（未分组桶）。 */
  chapter: Chapter | null
  frames: FrameLike[]
}

export function groupFramesByChapters(frames: ReadonlyArray<FrameLike>, chapters: ReadonlyArray<Chapter>): ChapterFrameGroup[] {
  if (chapters.length === 0) return [{ chapter: null, frames: [...frames] }]
  const sorted = [...chapters].sort((a, b) => a.at - b.at)
  const buckets: ChapterFrameGroup[] = sorted.map((chapter) => ({ chapter, frames: [] }))
  const loose: FrameLike[] = []
  for (const frame of frames) {
    if (frame.at == null) {
      loose.push(frame)
      continue
    }
    let placed = false
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (frame.at >= sorted[i]!.at) {
        buckets[i]!.frames.push(frame)
        placed = true
        break
      }
    }
    if (!placed) loose.push(frame)
  }
  const groups: ChapterFrameGroup[] = []
  if (loose.length > 0) groups.push({ chapter: null, frames: loose })
  for (const bucket of buckets) if (bucket.frames.length > 0) groups.push(bucket)
  return groups
}
