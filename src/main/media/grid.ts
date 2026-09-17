/**
 * Decode an image into an 8x8 luminance grid by block-mean downsampling
 * (app-context's keyframe dedupe input; extracted so the pipeline tests can
 * run the real implementation instead of a stub).
 *
 * 批1 (plan 2026-09-17 note-quality-upgrade): 关键帧是 JPEG、平台 PPT 页是 PNG，
 * 视觉融合要把两者比对，所以解码器按**文件魔数**分派而不是看扩展名。
 * pngjs 是 `phash.ts` 头注释里本来就写明的搭档解码器（MIT、零依赖）。
 */
import { readFileSync } from 'fs'
import { PNG } from 'pngjs'
import type { Grid8x8 } from '../../shared/phash'

/** 8-byte PNG signature; anything else is handed to the JPEG decoder. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface DecodedImage {
  /** RGBA bytes, 4 per pixel — both decoders are normalised to this layout. */
  data: Uint8Array | number[]
  width: number
  height: number
}

function decodeImage(buffer: Buffer): DecodedImage {
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    const png = PNG.sync.read(buffer)
    return { data: png.data, width: png.width, height: png.height }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jpeg = require('jpeg-js') as {
    decode: (b: Buffer, o?: { useTArray?: boolean }) => DecodedImage
  }
  return jpeg.decode(buffer, { useTArray: true })
}

export function decodeGrid8x8(filePath: string): Grid8x8 {
  const img = decodeImage(readFileSync(filePath))
  const cellW = img.width / 8
  const cellH = img.height / 8
  const grid: Grid8x8 = []
  for (let gy = 0; gy < 8; gy++) {
    const row: number[] = []
    for (let gx = 0; gx < 8; gx++) {
      let sum = 0
      let count = 0
      const y0 = Math.floor(gy * cellH)
      const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * cellH))
      const x0 = Math.floor(gx * cellW)
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cellW))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * img.width + x) * 4
          const r = img.data[idx] as number
          const g = img.data[idx + 1] as number
          const b = img.data[idx + 2] as number
          sum += 0.299 * r + 0.587 * g + 0.114 * b
          count++
        }
      }
      row.push(count > 0 ? sum / count : 128)
    }
    grid.push(row)
  }
  return grid
}
