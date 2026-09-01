import { describe, expect, it } from 'vitest'
import { chunkPlan, DEFAULT_CHUNK_SECONDS } from '../src/main/media/audio-split'

describe('chunkPlan (U4 ASR chunking)', () => {
  it('splits a 45-minute audio into 5 ten-minute chunks with clamped last end', () => {
    const plan = chunkPlan(45 * 60)
    expect(plan).toHaveLength(5)
    expect(plan[0]).toEqual({ index: 0, start: 0, end: 600 })
    expect(plan[4]).toEqual({ index: 4, start: 2400, end: 2700 })
  })

  it('produces a single chunk for short or zero-length audio', () => {
    expect(chunkPlan(30)).toHaveLength(1)
    expect(chunkPlan(0)).toHaveLength(1)
    expect(chunkPlan(0)[0]).toEqual({ index: 0, start: 0, end: 0 })
  })

  it('keeps chunk boundaries aligned to the configured window', () => {
    const plan = chunkPlan(DEFAULT_CHUNK_SECONDS * 2.5)
    expect(plan.map((c) => c.start)).toEqual([0, 600, 1200])
    expect(plan[2].end).toBe(1500)
  })
})
