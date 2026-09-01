import { describe, expect, it } from 'vitest'
import {
  casLoadErrorMessage,
  CAS_LOAD_TIMEOUT_MS,
  CAS_PRECHECK_TIMEOUT_MS,
  describeJsonShape,
  PLATFORM_API_BASE_PATH,
  SESSION_PROBE_PATH
} from '../src/main/auth/cas-login'

describe('cas-load error messages (no credentials, no full URLs)', () => {
  it('precheck failure names the platform and the network hint', () => {
    const msg = casLoadErrorMessage('precheck', 'fetch failed')
    expect(msg).toContain('无法连接')
    expect(msg).toContain('录播平台')
    expect(msg).toContain('VPN')
  })

  it('timeout failure states the budget', () => {
    const msg = casLoadErrorMessage('timeout', '')
    expect(msg).toContain('超时')
    expect(msg).toContain('25')
    expect(msg).toContain('录播平台')
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

describe('session probe targets the calibrated API (field 2026-09-01)', () => {
  it('polls the real course list endpoint, not a retired guess', () => {
    expect(SESSION_PROBE_PATH).toContain('/v1/group_subject_vod_list/t-1')
    expect(SESSION_PROBE_PATH).toContain('page.pageIndex=1')
  })

  it('API base has no -ui suffix (that is the static assets prefix)', () => {
    expect(PLATFORM_API_BASE_PATH).toBe('/jy-application-resourcemanage')
  })
})

describe('describeJsonShape logs field names only (no values, no secrets)', () => {
  it('describes nested objects one level deep', () => {
    const shape = describeJsonShape('{"code":200,"result":{"total":3,"extra":1}}')
    expect(shape).toBe('json{code,result{total,extra}}')
  })

  it('describes arrays with element count and first-element keys', () => {
    const shape = describeJsonShape('{"result":{"records":[{"courId":1,"courName":"x"}]}}')
    expect(shape).toBe('json{result{records[1]{courId,courName}}}')
  })

  it('keeps scalars and empty arrays readable', () => {
    expect(describeJsonShape('{"code":0,"list":[],"flag":true}')).toBe('json{code,list[0],flag}')
  })

  it('falls back to a byte count for non-json bodies', () => {
    expect(describeJsonShape('<html>404</html>')).toBe('non-json(16b)')
    expect(describeJsonShape('')).toBe('non-json(0b)')
  })
})
