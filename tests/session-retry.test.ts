import { describe, expect, it } from 'vitest'
import { withSessionRetry } from '../src/shared/session-retry'
import { okResult, errResult } from '../src/shared/api-result'

function sessionExpired(message: string): Error {
  return Object.assign(new Error(message), { kind: 'session_expired' })
}

describe('withSessionRetry (spec §2)', () => {
  it('retries the action once after a successful re-login on session_expired', async () => {
    let attempts = 0
    const action = async () => {
      attempts += 1
      if (attempts === 1) return errResult(sessionExpired('expired'))
      return okResult('ok')
    }
    const relogin = async () => okResult(true)
    const res = await withSessionRetry(action, relogin)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toBe('ok')
    expect(attempts).toBe(2)
  })

  it('does not re-login when the failure is not a session expiry', async () => {
    let attempts = 0
    let relogins = 0
    const action = async () => {
      attempts += 1
      return errResult(new Error('boom'))
    }
    const relogin = async () => {
      relogins += 1
      return okResult(true)
    }
    const res = await withSessionRetry(action, relogin)
    expect(res.ok).toBe(false)
    expect(attempts).toBe(1)
    expect(relogins).toBe(0)
  })

  it('keeps the original expiry error when re-login fails', async () => {
    const action = async () => errResult(sessionExpired('expired'))
    const relogin = async () => errResult(new Error('cas down'))
    const res = await withSessionRetry(action, relogin)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.kind).toBe('session_expired')
      expect(res.error).toBe('expired')
    }
  })

  it('returns immediately without re-login when the action succeeds', async () => {
    let relogins = 0
    const action = async () => okResult(42)
    const relogin = async () => {
      relogins += 1
      return okResult(true)
    }
    const res = await withSessionRetry(action, relogin)
    expect(res.ok).toBe(true)
    expect(relogins).toBe(0)
  })
})
