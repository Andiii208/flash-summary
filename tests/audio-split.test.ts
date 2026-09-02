import { describe, expect, it } from 'vitest'
import { chunkPlan, DEFAULT_CHUNK_SECONDS } from '../src/main/media/audio-split'

describe('chunkPlan (U4 ASR chunking)', () => {
  it('splits a 45-minute audio into 120s chunks (gateway base64 cap) with clamped last end', () => {
    const plan = chunkPlan(45 * 60)
    expect(plan).toHaveLength(23) // ceil(2700 / 120)
    expect(plan[0]).toEqual({ index: 0, start: 0, end: DEFAULT_CHUNK_SECONDS })
    expect(plan[22]).toEqual({ index: 22, start: 22 * DEFAULT_CHUNK_SECONDS, end: 2700 })
  })

  it('keeps every chunk raw size under the observed gateway cap', () => {
    // 16kHz mono 16-bit = 32,000 B/s; base64 inflates by 4/3. The gateway
    // resets connections above ~7MB encoded (field probe 2026-09-02), so
    // the encoded chunk must stay under ~6MB.
    const bytesPerSecond = 32_000
    expect((DEFAULT_CHUNK_SECONDS * bytesPerSecond * 4) / 3).toBeLessThan(6_000_000)
  })

  it('produces a single chunk for short or zero-length audio', () => {
    expect(chunkPlan(30)).toHaveLength(1)
    expect(chunkPlan(0)).toHaveLength(1)
    expect(chunkPlan(0)[0]).toEqual({ index: 0, start: 0, end: 0 })
  })

  it('keeps chunk boundaries aligned to the configured window', () => {
    const plan = chunkPlan(DEFAULT_CHUNK_SECONDS * 2.5)
    expect(plan.map((c) => c.start)).toEqual([0, DEFAULT_CHUNK_SECONDS, DEFAULT_CHUNK_SECONDS * 2])
    expect(plan[2].end).toBe(300)
  })

  it('honors an explicit chunk window (multipart providers can use larger chunks)', () => {
    const plan = chunkPlan(1500, 600)
    expect(plan.map((c) => c.start)).toEqual([0, 600, 1200])
    expect(plan[2].end).toBe(1500)
  })
})
