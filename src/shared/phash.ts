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

export interface DedupeOptions {
  /**
   * A4 (plan 2026-09-19-note-experience-overhaul): 时间覆盖桶数上限。
   * 给定时：贯心去重之后，空桶从该桶首个候选补一帧——“无画面变化的口播段”
   * （复习课/访谈/脴笑）不再整段零素材。不给（默认）时行为与旧完全一致。
   */
  coverageBuckets?: number
}

export function dedupeKeyframes(candidates: CandidateFrame[], threshold = 5, options?: DedupeOptions): KeptFrame[] {
  const kept: KeptFrame[] = []
  const keptIdx = new Set<number>()
  candidates.forEach((cand, i) => {
    const hash = averageHash(cand.grid)
    const dup = kept.some((k) => hammingDistance(k.hash, hash) <= threshold)
    if (!dup) {
      keptIdx.add(i)
      kept.push({ filePath: cand.filePath, timestampSeconds: cand.timestampSeconds, hash })
    }
  })
  if (options?.coverageBuckets == null || candidates.length === 0) return kept

  // 覆盖保底：按候选时间跳跃划桶，空桶补该桶首个候选（即使与已保留帧判重也补，覆盖优先于去重）。
  const times = candidates.map((c) => c.timestampSeconds)
  const span = Math.max(...times) - Math.min(...times)
  const bucketSeconds = Math.min(120, Math.max(30, Math.round(span / options.coverageBuckets)))
  const firstInBucket = new Map<number, number>()
  candidates.forEach((c, i) => {
    const bucket = Math.floor(c.timestampSeconds / bucketSeconds)
    if (!firstInBucket.has(bucket)) firstInBucket.set(bucket, i)
  })
  for (const [bucket, i] of [...firstInBucket.entries()].sort((a, b) => a[0] - b[0])) {
    const center = (bucket + 0.5) * bucketSeconds
    const covered = kept.some((k) => Math.abs(k.timestampSeconds - center) <= bucketSeconds / 2)
    if (covered || keptIdx.has(i)) continue
    const cand = candidates[i]!
    keptIdx.add(i)
    kept.push({ filePath: cand.filePath, timestampSeconds: cand.timestampSeconds, hash: averageHash(cand.grid) })
  }
  // 时间序保持与抽帧一致（预览/演示顺序稳定）。
  kept.sort((a, b) => a.timestampSeconds - b.timestampSeconds)
  return kept
}
