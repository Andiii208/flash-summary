/**
 * Bilibili QR-code login — pure helpers (plan 2026-09-06 M3).
 *
 * Web QR login: `passport.bilibili.com/x/passport-login/web/qrcode/generate`
 * returns the QR payload (url + qrcode_key); `…/qrcode/poll?qrcode_key=…`
 * walks 86101 (not scanned) → 86090 (scanned, unconfirmed) → 0 (confirmed)
 * or 86038 (expired). On confirmation the login cookies ride in
 * `data.url` (the crossDomain handoff URL) — they are parsed once here and
 * must never be logged.
 */

export type QrPollStatus = 'waiting' | 'scanned' | 'confirmed' | 'expired'

export interface QrGenerateResult {
  qrUrl: string
  qrcodeKey: string
}

/** generate payload → the QR content URL + polling key. */
export function parseQrGenerate(payload: unknown): QrGenerateResult | null {
  const data = (payload as { data?: Record<string, unknown> })?.data
  if (data == null) return null
  const url = data['url']
  const qrcodeKey = data['qrcode_key']
  if (typeof url !== 'string' || url === '' || typeof qrcodeKey !== 'string' || qrcodeKey === '') return null
  return { qrUrl: url, qrcodeKey: qrcodeKey }
}

/** Poll data.code → login status (documented code set). */
export function qrStatusFromCode(code: number): QrPollStatus {
  if (code === 0) return 'confirmed'
  if (code === 86090) return 'scanned'
  if (code === 86038) return 'expired'
  return 'waiting'
}

/**
 * Extract the login cookie string from the crossDomain handoff URL.
 * Returns `SESSDATA=…; bili_jct=…; DedeUserID=…` or null when SESSDATA is
 * absent (the one cookie every subtitle call needs).
 */
export function cookiesFromCrossDomainUrl(url: string): string | null {
  if (url === '') return null
  try {
    const params = new URL(url).searchParams
    const sessdata = params.get('SESSDATA')
    if (sessdata == null || sessdata === '') return null
    const biliJct = params.get('bili_jct') ?? ''
    const dedeUserId = params.get('DedeUserID') ?? ''
    const pairs = [`SESSDATA=${sessdata}`]
    if (biliJct !== '') pairs.push(`bili_jct=${biliJct}`)
    if (dedeUserId !== '') pairs.push(`DedeUserID=${dedeUserId}`)
    return pairs.join('; ')
  } catch {
    return null
  }
}

/**
 * Fallback for the legacy confirm shape: harvest the login cookies from a
 * Set-Cookie header (undici joins multiple values with ', '). Returns the
 * same `SESSDATA=…; bili_jct=…; DedeUserID=…` form or null.
 */
export function cookiesFromSetCookieHeader(setCookie: string): string | null {
  const pick = (name: string): string | null => {
    const match = new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`).exec(setCookie)
    return match != null && match[1] !== '' ? match[1] : null
  }
  const sessdata = pick('SESSDATA')
  if (sessdata == null) return null
  const biliJct = pick('bili_jct') ?? ''
  const dedeUserId = pick('DedeUserID') ?? ''
  const pairs = [`SESSDATA=${sessdata}`]
  if (biliJct !== '') pairs.push(`bili_jct=${biliJct}`)
  if (dedeUserId !== '') pairs.push(`DedeUserID=${dedeUserId}`)
  return pairs.join('; ')
}
