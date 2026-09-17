/**
 * Perceptual hashing (64-bit, 8x8 grayscale DCT-free average hash).
 *
 * Pure implementation over raw pixel data so it is unit-testable without
 * decoding real images: a decoder (pngjs/jpeg-js) feeds a 8x8 luminance
 * grid, this module hashes it.
 */
export type Grid8x8 = number[][]

/** Average hash: 1 bit per cell, set when the cell is brighter than the mean. */
export function averageHash(grid: Grid8x8): string {
  const flat = grid.flat()
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length
  let bits = ''
  for (const row of grid) {
    for (const v of row) {
      bits += v >= mean ? '1' : '0'
    }
  }
  return bits
}

/** Hamming distance between two hashes (0 = identical, 64 = opposite). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error('hash length mismatch')
  let d = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d++
  }
  return d
}

/** True when two frames are perceptually duplicates within a threshold. */
export function isDuplicate(a: string, b: string, threshold = 5): boolean {
  return hammingDistance(a, b) <= threshold
}

/**
 * Downscale-and-dedupe: from candidate keyframes (path, grid) pick unique
 * frames in order, skipping any whose hash is a near-duplicate of an
 * already-kept frame. This is the "去重" step of spec §3.6.
 */
export interface CandidateFrame {
  filePath: string
  timestampSeconds: number
  grid: Grid8x8
}

export interface KeptFrame {
  filePath: string
  timestampSeconds: number
  hash: string
}

export function dedupeKeyframes(candidates: CandidateFrame[], threshold = 5): KeptFrame[] {
  const kept: KeptFrame[] = []
  for (const cand of candidates) {
    const hash = averageHash(cand.grid)
    const dup = kept.some((k) => hammingDistance(k.hash, hash) <= threshold)
    if (!dup) kept.push({ filePath: cand.filePath, timestampSeconds: cand.timestampSeconds, hash })
  }
  return kept
}
