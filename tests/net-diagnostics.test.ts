import { describe, expect, it } from 'vitest'
import { DIRECT_NET_SWITCHES, PROXY_BYPASS_RULES, directNetRequested, isFakeIpResolution } from '../src/main/net-diagnostics'

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

describe('campus proxy hardening (A5)', () => {
  it('bypasses the system proxy for every campus host', () => {
    expect(PROXY_BYPASS_RULES).toContain('seu.edu.cn')
    expect(PROXY_BYPASS_RULES).toContain('*.seu.edu.cn')
  })
})

describe('isFakeIpResolution (Clash TUN DNS takeover)', () => {
  it('flags the mihomo fake-ip range and the ClashMI field case (172.19.x)', () => {
    expect(isFakeIpResolution(['198.18.0.38'])).toBe(true)
    expect(isFakeIpResolution(['198.19.255.1'])).toBe(true)
    expect(isFakeIpResolution(['172.19.0.38'])).toBe(true)
    expect(isFakeIpResolution(['172.16.1.2', '58.192.114.3'])).toBe(true)
  })

  it('accepts healthy public campus resolution', () => {
    expect(isFakeIpResolution(['58.192.114.3'])).toBe(false)
    expect(isFakeIpResolution(['2026:db8::1'])).toBe(false)
    expect(isFakeIpResolution([])).toBe(false)
    expect(isFakeIpResolution(['not-an-ip'])).toBe(false)
  })

  it('does not flag private ranges outside the virtual ones', () => {
    expect(isFakeIpResolution(['172.32.0.1'])).toBe(false)
    expect(isFakeIpResolution(['10.0.0.5'])).toBe(false)
  })
})
