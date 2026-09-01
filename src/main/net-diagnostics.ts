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
