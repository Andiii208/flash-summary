import { describe, expect, it } from 'vitest'
import { APP_TITLE, type PingResult } from '../src/shared/types'

describe('shared types', () => {
  it('exposes the app title used by both processes', () => {
    expect(APP_TITLE).toBe('SEU Summary')
  })

  it('models a ping result shape', () => {
    const result: PingResult = { ok: true, pong: 'pong:phase0' }
    expect(result.ok).toBe(true)
    expect(result.pong.startsWith('pong:')).toBe(true)
  })
})
