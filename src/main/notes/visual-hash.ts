/**
 * 视觉候选的哈希装配（批1b, plan 2026-09-17 note-quality-upgrade）。
 *
 * 与 `shared/notes/visual-fusion.ts` 的分工：那边是**纯**融合算法（只吃哈希，
 * 可单测）；这边负责从磁盘解码出哈希——唯一的副作用点。
 *
 * 解码失败**不丢候选**：把 `hash` 置 null 交给融合层处置（关键帧照发、PPT 页
 * 不发，见 `VisualCandidate.hash` 的说明）。一张读不出的图片不该毁掉一份笔记，
 * 也不该被静默地从提示里拿掉。
 */
import { averageHash, isDuplicate } from '../../shared/phash'
import { decodeGridPreferThumb } from '../media/grid'
import { resolveLibraryPath } from '../library/paths'
import type { VisualCandidate } from '../../shared/notes/visual-fusion'

export interface PptRow {
  page_index: number
  file_path: string
}

export interface KeyframeRow {
  id: string
  file_path: string
  timestamp_seconds: number
}

/**
 * 解码一张图的 8x8 哈希；读不出/解不开返回 null（候选保留，退出匹配）。
 * 批3：有缩略图解缩略图（64px 宽的哈希专用同伴），没有回落原图。
 */
function hashOf(filePath: string): string | null {
  try {
    return averageHash(decodeGridPreferThumb(filePath))
  } catch {
    return null
  }
}

/**
 * 组装融合候选。
 *
 * 同源去重在这里做一次：关键帧在抽帧阶段已按帧内阈值去过重（`orchestrator`），
 * PPT 页则完全没有去重（同一页可能被平台重复列出，而且整份 course deck 会随
 * 每个 lesson 各存一份）。阈值与抽帧阶段一致（5，见 `phash.isDuplicate` 默认值）。
 */
export function buildVisualCandidates(
  pptRows: ReadonlyArray<PptRow>,
  keyframeRows: ReadonlyArray<KeyframeRow>,
  libraryRoot: string
): VisualCandidate[] {
  const pptCandidates: VisualCandidate[] = []
  for (const row of pptRows) {
    const hash = hashOf(resolveLibraryPath(libraryRoot, row.file_path))
    if (hash != null && pptCandidates.some((kept) => kept.hash != null && isDuplicate(kept.hash, hash))) continue
    pptCandidates.push({ ref: `ppt:${row.page_index}`, kind: 'ppt', at: null, hash })
  }

  const keyframeCandidates: VisualCandidate[] = []
  for (const row of [...keyframeRows].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)) {
    const hash = hashOf(resolveLibraryPath(libraryRoot, row.file_path))
    if (hash != null && keyframeCandidates.some((kept) => kept.hash != null && isDuplicate(kept.hash, hash))) continue
    keyframeCandidates.push({
      ref: `kf:${row.id}`,
      kind: 'keyframe',
      at: Math.round(row.timestamp_seconds),
      hash
    })
  }
  return [...pptCandidates, ...keyframeCandidates]
}
