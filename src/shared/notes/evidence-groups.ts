/**
 * A6 (plan 2026-09-19-note-experience-overhaul): 图集近重复帧折叠。
 *
 * 静态幻灯片/讲者口头讲解时段，关键帧抽帧 + 去重后入库的帧仍会「同一页 N 份」
 * （略微不同的拍摄/压缩）。图集平铺时用户看到的是同一页幻灯片重复 N 次——
 * 视觉信息量低还占满屏幕。本模块把感知哈希相近的帧折成一组：默认展示代表帧
 * （组内第一张，时间序稳定），caption 说明「N 张近重复」，可展开看全部。
 *
 * 纯函数；无哈希的帧不参与折叠判定（保守：宁可平铺，不可错折）。
 */
import { hammingDistance } from '../phash'

export interface EvidenceFrame {
  ref: string
  dataUrl: string
  origin: 'evidence' | 'nearest'
  hash?: string | null
}

export interface EvidenceFrameGroup {
  representative: EvidenceFrame
  members: EvidenceFrame[]
}

/** 组内相似阈值：与 keyframes 入库去重同档（5/64）。 */
export const GALLERY_FOLD_DISTANCE = 5

export function foldNearDuplicateFrames(
  frames: ReadonlyArray<EvidenceFrame>,
  threshold: number = GALLERY_FOLD_DISTANCE
): EvidenceFrameGroup[] {
  const groups: EvidenceFrameGroup[] = []
  for (const frame of frames) {
    if (frame.hash == null || frame.hash === '') {
      groups.push({ representative: frame, members: [frame] })
      continue
    }
    const hit = groups.find(
      (g) => g.representative.hash != null && hammingDistance(g.representative.hash as string, frame.hash as string) <= threshold
    )
    if (hit != null) {
      hit.members.push(frame)
      continue
    }
    groups.push({ representative: frame, members: [frame] })
  }
  return groups
}
