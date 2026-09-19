import { describe, expect, it, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { decodeGrid8x8, thumbPathFor, decodeGridPreferThumb } from '../src/main/media/grid'
import { averageHash, hammingDistance } from '../src/shared/phash'

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
  rmSync(join(tmpdir(), 'grid-test.png'), { force: true })
  rmSync(join(tmpdir(), 'grid-test-broken.bin'), { force: true })
  rmSync(join(tmpdir(), 'thumb-grid-test.jpg'), { force: true })
  rmSync(join(tmpdir(), 'thumb-grid-test.png'), { force: true })
})

/** Materialize the encoded jpeg on disk: decodeGrid8x8 reads a file path. */
function writeSplitJpeg(): string {
  const file = join(tmpdir(), 'grid-test.jpg')
  writeFileSync(file, encodeSplitJpeg())
  return file
}

/** 同样内容的 PNG。批1b 起 PPT 页是 PNG，解码器必须按魔数分派。 */
function writeSplitPng(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PNG } = require('pngjs') as {
    PNG: { sync: { write: (data: { data: Uint8Array; width: number; height: number }) => Buffer } }
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
  const file = join(tmpdir(), 'grid-test.png')
  writeFileSync(file, PNG.sync.write({ data, width, height }))
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

  it('批1b: 按魔数分派——同一内容编成 PNG 也解得出且结果一致', () => {
    // PPT 页是 PNG、关键帧是 JPEG，两者要能进同一个哈希空间比对。
    const pngGrid = decodeGrid8x8(writeSplitPng())
    const jpegGrid = decodeGrid8x8(writeSplitJpeg())
    expect(pngGrid).toHaveLength(8)
    for (let gy = 0; gy < 8; gy++) {
      expect(pngGrid[gy]![0]).toBeLessThan(40)
      expect(pngGrid[gy]![7]).toBeGreaterThan(215)
      // 无损 PNG 与有损 JPEG 的块均值应当接近（同图同判据）
      expect(Math.abs(pngGrid[gy]![7]! - jpegGrid[gy]![7]!)).toBeLessThan(12)
    }
  })

  it('批1b: 坏文件抛错而不是返回垃圾网格（调用方据此降级为 null 哈希）', () => {
    const broken = join(tmpdir(), 'grid-test-broken.bin')
    writeFileSync(broken, Buffer.from([0x00, 0x01, 0x02, 0x03]))
    expect(() => decodeGrid8x8(broken)).toThrow()
  })
})

describe('批3: thumbPathFor / decodeGridPreferThumb（哈希走 64px 缩略图）', () => {
  it('命名单一事实源：同目录 thumb- 前缀（关键帧与 PPT 页同规则）', () => {
    expect(thumbPathFor(join('C:', 'cache', 'task-1', 'keyframes', 'frame-0001.jpg'))).toBe(
      join('C:', 'cache', 'task-1', 'keyframes', 'thumb-frame-0001.jpg')
    )
    expect(thumbPathFor(join('L:', 'attachments', 'l1', 'ppt', 'page-000.png'))).toBe(
      join('L:', 'attachments', 'l1', 'ppt', 'thumb-page-000.png')
    )
  })

  it('有缩略图时只读缩略图（原图被写坏也解得出——证明没碰原图）', () => {
    const original = writeSplitJpeg()
    // 32x32 同款左右分割「缩略图」：块均值网格应与 64x64 原图同判。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jpeg = require('jpeg-js') as {
      encode: (data: { data: Uint8Array; width: number; height: number }, quality: number) => { data: Buffer }
    }
    const w = 32
    const h = 32
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const v = x < w / 2 ? 0 : 255
        data[idx] = v
        data[idx + 1] = v
        data[idx + 2] = v
        data[idx + 3] = 255
      }
    }
    writeFileSync(thumbPathFor(original), jpeg.encode({ data, width: w, height: h }, 90).data)
    writeFileSync(original, Buffer.from([0x00, 0x01, 0x02, 0x03])) // 原图写坏
    const grid = decodeGridPreferThumb(original)
    expect(grid).toHaveLength(8)
    expect(grid[0]![0]).toBeLessThan(40)
    expect(grid[0]![7]).toBeGreaterThan(215)
  })

  it('缩略图缺失时回落原图（历史库/生成失败不丢候选）', () => {
    const original = writeSplitJpeg()
    expect(decodeGridPreferThumb(original)).toEqual(decodeGrid8x8(original))
  })

  it('缩略图哈希与原图哈希一致（同图同判据，合成样本 hamming=0）', () => {
    const original = writeSplitJpeg()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jpeg = require('jpeg-js') as {
      encode: (data: { data: Uint8Array; width: number; height: number }, quality: number) => { data: Buffer }
    }
    const w = 32
    const h = 32
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const v = x < w / 2 ? 0 : 255
        data[idx] = v
        data[idx + 1] = v
        data[idx + 2] = v
        data[idx + 3] = 255
      }
    }
    writeFileSync(thumbPathFor(original), jpeg.encode({ data, width: w, height: h }, 90).data)
    const d = hammingDistance(averageHash(decodeGridPreferThumb(original)), averageHash(decodeGrid8x8(original)))
    expect(d).toBeLessThanOrEqual(2)
  })
})
