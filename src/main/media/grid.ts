/**
 * Decode a jpeg into an 8x8 luminance grid by block-mean downsampling
 * (app-context's keyframe dedupe input; extracted so the pipeline tests can
 * run the real implementation instead of a stub).
 */
import { readFileSync } from 'fs'
import type { Grid8x8 } from './phash'

export function decodeGrid8x8(filePath: string): Grid8x8 {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jpeg = require('jpeg-js') as {
    decode: (b: Buffer, o?: { useTArray?: boolean }) => { data: Uint8Array | number[]; width: number; height: number }
  }
  const img = jpeg.decode(readFileSync(filePath), { useTArray: true })
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
