import { describe, expect, it, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { decodeGrid8x8 } from '../src/main/media/grid'

/**
 * The 8x8 luminance decoder (extracted from app-context in the combined
 * audit) over real jpeg-js encode/decode round-trips.
 */

/** Encode a 64x64 jpeg whose left half is black and right half is white. */
function encodeSplitJpeg(): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jpeg = require('jpeg-js') as {
    encode: (data: { data: Uint8Array; width: number; height: number }, quality: number) => { data: Buffer }
  }
  const width = 64
  const height = 64
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const v = x < width / 2 ? 0 : 255
      data[idx] = v
      data[idx + 1] = v
      data[idx + 2] = v
      data[idx + 3] = 255
    }
  }
  return jpeg.encode({ data, width, height }, 90).data
}

afterEach(() => {
  rmSync(join(tmpdir(), 'grid-test.jpg'), { force: true })
})

/** Materialize the encoded jpeg on disk: decodeGrid8x8 reads a file path. */
function writeSplitJpeg(): string {
  const file = join(tmpdir(), 'grid-test.jpg')
  writeFileSync(file, encodeSplitJpeg())
  return file
}

describe('decodeGrid8x8 (block-mean luminance for phash)', () => {
  it('resolves an 8x8 grid from a real jpeg', () => {
    const grid = decodeGrid8x8(writeSplitJpeg())
    expect(grid).toHaveLength(8)
    for (const row of grid) expect(row).toHaveLength(8)
  })

  it('separates a black/white split: dark columns near 0, bright near 255', () => {
    const grid = decodeGrid8x8(writeSplitJpeg())
    for (let gy = 0; gy < 8; gy++) {
      expect(grid[gy]![0]).toBeLessThan(40)
      expect(grid[gy]![7]).toBeGreaterThan(215)
    }
  })

  it('keeps luminance monotonic across the split midpoint', () => {
    const grid = decodeGrid8x8(writeSplitJpeg())
    const row = grid[4]!
    for (let gx = 1; gx < 8; gx++) {
      expect(row[gx]!).toBeGreaterThanOrEqual(row[gx - 1]!)
    }
  })
})
