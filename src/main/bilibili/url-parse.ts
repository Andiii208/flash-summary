/**
 * Bilibili URL/BV-id parsing — pure functions (plan 2026-09-06 M2).
 *
 * Accepts a bare BV id, a full video URL (www/m), or a b23.tv short link.
 * av-number links are reported distinctly so the UI can give an actionable
 * message: the whole pipeline keys on bvid and the plan scopes av out of MVP.
 */

export type ParsedBiliInput =
  | { kind: 'bvid'; bvid: string; page: number | null }
  | { kind: 'short_link' }
  | { kind: 'av_unsupported' }

const BVID_RE = /BV[0-9A-Za-z]{10}/

/** Classify a user-provided video reference (BV id, URL, or short link). */
export function parseBiliInput(rawInput: string): ParsedBiliInput | null {
  const input = rawInput.trim()
  if (input === '') return null
  if (/b23\.tv\//.test(input)) return { kind: 'short_link' }
  if (/^BV[0-9A-Za-z]{10}$/.test(input)) return { kind: 'bvid', bvid: input, page: null }
  if (/\/av\d+/i.test(input) || /^av\d+$/i.test(input)) return { kind: 'av_unsupported' }
  const match = BVID_RE.exec(input)
  if (match == null || !/bilibili\.com\/video\//.test(input)) return null
  return { kind: 'bvid', bvid: match[0], page: readPageParam(input) }
}

/** The ?p=N query param (P numbers are 1-based; ?p=0 or junk reads as null). */
export function readPageParam(url: string): number | null {
  try {
    const query = new URL(url, 'https://www.bilibili.com').searchParams
    const page = Number.parseInt(query.get('p') ?? '', 10)
    if (!Number.isInteger(page) || page < 1) return null
    return page
  } catch {
    return null
  }
}

/** Canonical BV course/lesson ids (migration 009 conventions). */
export function biliCourseId(bvid: string): string {
  return `bili-${bvid}`
}

export function biliLessonId(bvid: string, page: number): string {
  return `bili-${bvid}-P${page}`
}
