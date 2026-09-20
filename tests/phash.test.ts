import { describe, expect, it } from 'vitest'
import { averageHash, hammingDistance, isDuplicate, dedupeKeyframes, type Grid8x8 } from '../src/shared/phash'

function solidGrid(v: number): Grid8x8 {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => v))
}

function halfGrid(): Grid8x8 {
  return Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, () => (r < 4 ? 200 : 20)))
}

describe('averageHash', () => {
  it('produces identical hashes for identical grids', () => {
    expect(averageHash(solidGrid(100))).toBe(averageHash(solidGrid(100)))
  })

  it('produces all-1 hash for uniform grid (all cells >= mean)', () => {
    expect(averageHash(solidGrid(50))).toBe('1'.repeat(64))
  })

  it('separates a half-bright image into distinct top/bottom bits', () => {
    expect(averageHash(halfGrid())).toBe('1'.repeat(32) + '0'.repeat(32))
  })
})

describe('hammingDistance / isDuplicate', () => {
  it('counts differing bits', () => {
    expect(hammingDistance('1'.repeat(64), '0'.repeat(64))).toBe(64)
    expect(hammingDistance('1010', '1010')).toBe(0)
    expect(hammingDistance('1010', '1011')).toBe(1)
  })

  it('flags near-identical frames as duplicates within threshold', () => {
    const a = averageHash(halfGrid())
    const noisy = a.slice(0, 60) + '01' + a.slice(62) // 2 bits differ
    expect(isDuplicate(a, noisy, 5)).toBe(true)
    expect(isDuplicate(a, '0'.repeat(64), 5)).toBe(false)
  })
})

describe('dedupeKeyframes', () => {
  it('keeps first of a duplicate run, keeps genuinely new frames', () => {
    const base = halfGrid()
    const variant: Grid8x8 = base.map((row, r) => row.map((v) => (r === 0 ? v - 5 : v))) // tiny change
    const other = solidGrid(0)

    const kept = dedupeKeyframes([
      { filePath: 'a.jpg', timestampSeconds: 0, grid: base },
      { filePath: 'b.jpg', timestampSeconds: 10, grid: variant }, // near-dup of a
      { filePath: 'c.jpg', timestampSeconds: 20, grid: other } // genuinely different
    ])

    expect(kept.map((k) => k.filePath)).toEqual(['a.jpg', 'c.jpg'])
    expect(kept[0].timestampSeconds).toBe(0)
  })
})

describe('A4 覆盖保底（plan 2026-09-19-note-experience-overhaul）', () => {
  /** 造 n 个「全同哈希」的候选（模拟无画面变化的口播段）。 */
  const staticCandidates = (n: number, step: number) =>
    Array.from({ length: n }, (_, i) => ({ filePath: `f${i}.jpg`, timestampSeconds: i * step, grid: solidGrid(128) }))
  /** 造一个与背景不同的帧（哈希差异 > 阈值）。 */
  const distinctCandidate = (at: number) => ({ filePath: 'x.jpg', timestampSeconds: at, grid: halfGrid() })

  it('不传 options → 行为与旧版逐字节一致', () => {
    const candidates = [...staticCandidates(200, 10), distinctCandidate(1000)]
    const plain = dedupeKeyframes(candidates, 5)
    expect(plain.map((f) => Math.round(f.timestampSeconds))).toEqual([0, 1000])
  })

  it('全静态长段：覆盖保底后每桶至少一帧（口播段不再零素材）', () => {
    // 2000s 全程静态、20s 一候选 → 桶≈17s（clamp 到 30s）→ 约 66 桶各补一帧。
    const kept = dedupeKeyframes(staticCandidates(100, 20), 5, { coverageBuckets: 120 })
    expect(kept.length).toBeGreaterThan(30)
    const times = kept.map((f) => f.timestampSeconds)
    expect([...times].sort((a, b) => a - b)).toEqual(times) // 时间序
    const maxGap = Math.max(...times.slice(1).map((t, i) => t - times[i]!))
    // 最坏闞伸 = 桶宽(30) + 候选步长(20)；设计目标是“不出现整分钟级的零素材段”。
    expect(maxGap).toBeLessThanOrEqual(60)
  })

  it('去重已覆盖的桶不重复补帧', () => {
    const kept = dedupeKeyframes([...staticCandidates(3, 10), distinctCandidate(15)], 5, { coverageBuckets: 120 })
    // 30s 最小桶：0/10/15 同桶且已有差异帧 → 不补。
    expect(kept.length).toBe(2)
  })
})
