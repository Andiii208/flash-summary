import { describe, expect, it } from 'vitest'
import { foldNearDuplicateFrames, type EvidenceFrame } from '../src/shared/notes/evidence-groups'
import { averageHash } from '../src/shared/phash'
import type { Grid8x8 } from '../src/shared/phash'

/** 结构化网格（纯色块对 averageHash 恒等，必须有结构才能产生差异）。 */
const grid = (flip: boolean): Grid8x8 => {
  const rows: number[][] = []
  for (let r = 0; r < 8; r++) {
    const row: number[] = []
    for (let c = 0; c < 8; c++) row.push(r < 4 !== flip ? 220 : 20)
    rows.push(row)
  }
  return rows
}

const frame = (ref: string, flip: boolean): EvidenceFrame => ({
  ref,
  dataUrl: `data:image/jpeg;base64,${ref}`,
  origin: 'nearest',
  hash: averageHash(grid(flip))
})

describe('foldNearDuplicateFrames（A6, plan 2026-09-19）', () => {
  it('同哈希平铺 → 折成一组（代表帧 + 成员）', () => {
    const groups = foldNearDuplicateFrames([frame('kf:a', false), frame('kf:b', false), frame('kf:c', false)])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.representative.ref).toBe('kf:a')
    expect(groups[0]?.members.map((m) => m.ref)).toEqual(['kf:a', 'kf:b', 'kf:c'])
  })

  it('哈希差异大 → 各自成组', () => {
    const dark: EvidenceFrame = { ref: 'kf:dark', dataUrl: '', origin: 'nearest', hash: averageHash(grid(false)) }
    const bright: EvidenceFrame = { ref: 'kf:bright', dataUrl: '', origin: 'nearest', hash: averageHash(grid(true)) }
    const groups = foldNearDuplicateFrames([dark, bright])
    expect(groups).toHaveLength(2)
  })

  it('无哈希的帧不参与折叠（保守：宁可平铺，不可错折）', () => {
    const groups = foldNearDuplicateFrames([
      { ref: 'kf:x', dataUrl: '', origin: 'nearest' },
      { ref: 'kf:y', dataUrl: '', origin: 'nearest' }
    ])
    expect(groups).toHaveLength(2)
  })

  it('顺序稳定：组按代表帧首次出现排序', () => {
    const groups = foldNearDuplicateFrames([frame('kf:a', false), frame('kf:b', true), frame('kf:c', false)])
    expect(groups.map((g) => g.representative.ref)).toEqual(['kf:a', 'kf:b'])
    expect(groups[0]?.members).toHaveLength(2)
  })
})
