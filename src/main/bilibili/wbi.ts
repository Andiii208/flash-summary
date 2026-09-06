/**
 * WBI request signing for the Bilibili web API (plan 2026-09-06 M2).
 *
 * Mechanism per the community API documentation: fetch img_key/sub_key from
 * the nav endpoint (works logged-out), shuffle `imgKey+subKey` through a
 * fixed 64-entry permutation table taking the first 32 chars, append `wts`
 * (unix seconds) to the params, sort keys ascending, strip "!'()*" from
 * values, urlencode, and md5(query + mixinKey) → `w_rid`.
 *
 * Keys rotate daily; they are cached in memory for 30 minutes so one task
 * reuses them and a long session refreshes without plumbing.
 */
import { createHash } from 'crypto'

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
]

/** Key cache window — well under the daily rotation, above one task run. */
export const WBI_KEY_TTL_MS = 30 * 60 * 1000

export interface WbiKeys {
  imgKey: string
  subKey: string
}

export function getMixinKey(orig: string): string {
  return MIXIN_KEY_ENC_TAB.map((index) => orig[index]).join('').slice(0, 32)
}

/** Keys live in the nav payload's wbi_img URLs' file names. */
export function extractWbiKeys(navPayload: unknown): WbiKeys | null {
  const data = (navPayload as { data?: { wbi_img?: { img_url?: unknown; sub_url?: unknown } } })?.data
  const imgUrl = data?.wbi_img?.img_url
  const subUrl = data?.wbi_img?.sub_url
  if (typeof imgUrl !== 'string' || typeof subUrl !== 'string') return null
  const imgKey = keyFromUrl(imgUrl)
  const subKey = keyFromUrl(subUrl)
  if (imgKey === '' || subKey === '') return null
  return { imgKey, subKey }
}

function keyFromUrl(url: string): string {
  const fileName = url.split('/').pop() ?? ''
  return fileName.split('.')[0]
}

/** Sign request params: returns a new param object including wts and w_rid. */
export function wbiSign(params: Record<string, string>, keys: WbiKeys, nowSeconds: number): Record<string, string> {
  const mixinKey = getMixinKey(keys.imgKey + keys.subKey)
  const all: Record<string, string> = { ...params, wts: String(nowSeconds) }
  const sortedKeys = Object.keys(all).sort()
  const sanitized: Record<string, string> = {}
  for (const key of sortedKeys) sanitized[key] = stripWbiChars(all[key])
  const query = new URLSearchParams(sanitized).toString()
  const wRid = createHash('md5').update(query + mixinKey).digest('hex')
  return { ...sanitized, w_rid: wRid }
}

function stripWbiChars(value: string): string {
  return Array.from(value)
    .filter((ch) => !'!\'()*'.includes(ch))
    .join('')
}

/** Signed-playurl query: stream gateway wants the risk-control fingerprints too. */
export function signedPlayUrlParams(base: Record<string, string>, keys: WbiKeys, dmParams: Record<string, string>, nowSeconds: number): Record<string, string> {
  return wbiSign({ ...base, ...dmParams }, keys, nowSeconds)
}
