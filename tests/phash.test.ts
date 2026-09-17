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
