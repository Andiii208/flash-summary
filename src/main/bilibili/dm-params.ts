/**
 * Bilibili playurl risk-control fingerprint params (plan 2026-09-06 M2).
 *
 * Around 2026-06 the `x/player/wbi/playurl` gateway began answering requests
 * that omit the browser-fingerprint dm_img_* / web_location params with
 * HTTP 412 (enforcement is per-video, not global). The reference open-source
 * implementation (BiliNote `bilibili_dm_patch.py`) injects well-formed dummy
 * values *before* WBI signing and ships working — we mirror those exact
 * value shapes. Cookies do not fix a 412; the params themselves are required.
 */

export function buildDmImgParams(randomSource: () => string = defaultRandom): Record<string, string> {
  return {
    web_location: '1550101',
    dm_img_list: '[]',
    dm_img_str: base64Trimmed(randomSource, 16, 64),
    dm_cover_img_str: base64Trimmed(randomSource, 32, 128),
    dm_img_inter: '{"ds":[],"wh":[6093,6631,31],"of":[430,760,380]}'
  }
}

function base64Trimmed(randomSource: () => string, minLen: number, maxLen: number): string {
  const length = minLen + Math.floor(randomSource().length % (maxLen - minLen))
  let raw = ''
  while (raw.length < length) raw += randomSource()
  return Buffer.from(raw.slice(0, length), 'utf-8').toString('base64').replace(/=+$/, '')
}

function defaultRandom(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}
