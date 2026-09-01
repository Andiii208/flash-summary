import { describe, expect, it } from 'vitest'
import { DIRECT_NET_SWITCHES, directNetRequested } from '../src/main/net-diagnostics'

describe('direct-net diagnostic flag', () => {
  it('activates on the launch flag in any argv position', () => {
    expect(directNetRequested(['electron', 'app', '--seu-direct-net'], undefined)).toBe(true)
    expect(directNetRequested(['--seu-direct-net'], undefined)).toBe(true)
  })

  it('activates via the SEU_DIRECT_NET=1 environment fallback', () => {
    expect(directNetRequested([], '1')).toBe(true)
    expect(directNetRequested([], '0')).toBe(false)
    expect(directNetRequested([], undefined)).toBe(false)
  })

  it('stays off for a normal launch', () => {
    expect(directNetRequested(['electron', 'app'], undefined)).toBe(false)
    expect(directNetRequested(['electron', 'app', '--seu-trace-keep-window'], undefined)).toBe(false)
  })

  it('bypasses every suspect layer: proxy, QUIC, Chromium DNS', () => {
    expect([...DIRECT_NET_SWITCHES]).toContain('no-proxy-server')
    expect([...DIRECT_NET_SWITCHES]).toContain('disable-quic')
    expect([...DIRECT_NET_SWITCHES]).toContain('disable-async-dns')
  })
})
