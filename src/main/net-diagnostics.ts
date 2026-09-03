/**
 * --seu-direct-net (field diagnosis, 2026-09-01): node-side fetch reaches
 * cvs.seu.edu.cn instantly while a Chromium window sometimes hangs with no
 * request and no error. The difference must live in Chromium's own network
 * stack, so this flag turns off each suspect layer for an A/B test:
 *
 * - no-proxy-server: skip the OS proxy config (Clash Mi leaves a system
 *   proxy / TUN residue even when "disabled" in its UI)
 * - disable-quic: skip UDP/HTTP3, force plain TCP like node fetch does
 * - disable-async-dns: skip Chromium's internal DNS (incl. DoH), use the
 *   system resolver like node does
 *
 * If login works with the flag, bisect the switches to pin the layer.
 */

export const DIRECT_NET_SWITCHES = ['no-proxy-server', 'disable-quic', 'disable-async-dns'] as const

/** True when the app was launched with the direct-network diagnostic flag. */
export function directNetRequested(argv: readonly string[], directNetEnv: string | undefined): boolean {
  return argv.includes('--seu-direct-net') || directNetEnv === '1'
}

/**
 * Chromium honours the OS system proxy, and a proxy rule that sends the
 * campus domains through an external exit breaks the platform page (field
 * case 2026-09-03: ERR_CONNECTION_CLOSED on every login attempt). The
 * campus hosts are reachable directly by design, so the app-level session
 * always bypasses the system proxy for them. Clash TUN intercepts below the
 * app layer — that still needs the user's DOMAIN-SUFFIX,seu.edu.cn,DIRECT
 * rule (README troubleshooting).
 */
export const PROXY_BYPASS_RULES = 'seu.edu.cn,*.seu.edu.cn'

/**
 * Fake-IP classifier: a Clash-style TUN resolver answers campus lookups
 * with a virtual private address (standard mihomo range 198.18.0.0/15; the
 * ClashMI field case answered 172.19.x). Healthy resolution is public
 * (58.192.x.x), so a private/virtual answer means DNS is intercepted and
 * school traffic will be RST — surface the rule-fix guidance up front.
 */
export function isFakeIpResolution(addresses: readonly string[]): boolean {
  return addresses.some((ip) => {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
    if (match == null) return false
    const first = Number(match[1])
    const second = Number(match[2])
    if (first === 198 && second >= 18 && second <= 19) return true
    if (first === 172 && second >= 16 && second <= 31) return true
    return false
  })
}
