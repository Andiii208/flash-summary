import { describe, expect, it } from 'vitest'
import { casLoadErrorMessage, CAS_LOAD_TIMEOUT_MS, CAS_PRECHECK_TIMEOUT_MS } from '../src/main/auth/cas-login'

describe('cas-load error messages (no credentials, no full URLs)', () => {
  it('precheck failure names the host and the network hint', () => {
    const msg = casLoadErrorMessage('precheck', 'fetch failed')
    expect(msg).toContain('无法连接')
    expect(msg).toContain('ids.seu.edu.cn')
    expect(msg).toContain('VPN')
  })

  it('timeout failure states the budget', () => {
    const msg = casLoadErrorMessage('timeout', '')
    expect(msg).toContain('超时')
    expect(msg).toContain('25')
    expect(msg).toContain('ids.seu.edu.cn')
  })

  it('load failure carries the description without URLs', () => {
    const msg = casLoadErrorMessage('load', 'ERR_CONNECTION_RESET')
    expect(msg).toContain('ERR_CONNECTION_RESET')
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('keeps budgets tight so a dead network fails fast', () => {
    expect(CAS_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
    expect(CAS_PRECHECK_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
  })
})
