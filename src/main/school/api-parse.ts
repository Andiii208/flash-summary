/**
 * Pure helpers for school API responses and session state.
 *
 * Kept side-effect free so they can be unit-tested against recorded fixtures
 * without any network access.
 */

/** True when the app was redirected to the CAS login page (session expired). */
export function isCasLoginRedirect(url: string): boolean {
  return /\/(cas|login|sso)\b|ids\.seu\.edu\.cn|authserver/i.test(url)
}

export interface CourseSummary {
  id: string
  name: string
  term?: string
  teacher?: string
}

export interface LessonDetail {
  id: string
  courseId: string
  title: string
  startedAt?: string
  durationSeconds?: number
  /** Teacher stream (1170193-1) URL, if present. */
  teacherStreamUrl?: string
  /** Screen/PPT stream (1170195-5) URL, if present. */
  screenStreamUrl?: string
  pptCourseId?: string
}

/**
 * Extract a cookie header value from a Set-Cookie list, dropping attributes
 * (Path, HttpOnly, ...). Only names and values are persisted, never logged.
 */
export function cookieStringFromSetCookies(setCookies: string[]): string {
  const pairs: string[] = []
  for (const raw of setCookies) {
    const first = raw.split(';')[0]?.trim()
    if (first && first.includes('=')) pairs.push(first)
  }
  return pairs.join('; ')
}

/** Merge an existing cookie string with new pairs; new values win. */
export function mergeCookieStrings(existing: string, incoming: string): string {
  const map = new Map<string, string>()
  for (const pair of [...existing.split(';'), ...incoming.split(';')]) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Parse the course list payload. The school platform returns either an array
 * or a `{ list: [...] }` wrapper; tolerate both, map unknown fields to ''.
 */
export function parseCourseList(payload: unknown): CourseSummary[] {
  const list = Array.isArray(payload)
    ? payload
    : payload != null && typeof payload === 'object' && Array.isArray((payload as { list?: unknown[] }).list)
      ? (payload as { list: unknown[] }).list
      : []
  return list
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => {
      const id = pickString(item, ['courseId', 'course_id', 'id', 'courseNo'])
      const name = pickString(item, ['courseName', 'course_name', 'name', 'title'])
      const term = pickString(item, ['term', 'semester', 'termName'])
      const teacher = pickString(item, ['teacher', 'teacherName', 'lecturer'])
      return { id, name, ...(term ? { term } : {}), ...(teacher ? { teacher } : {}) }
    })
    .filter((c) => c.id !== '')
}

/**
 * Parse lesson detail. Stream identifiers follow the Kedacom layout:
 * teacher `1170193-1`, screen/PPT `1170195-5`; panorama `1170194-3` is
 * deliberately never extracted.
 */
export function parseLessonDetail(payload: unknown, courseId: string): LessonDetail | null {
  if (payload == null || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  const rec = (obj.data != null && typeof obj.data === 'object' ? obj.data : obj) as Record<string, unknown>

  const id = pickString(rec, ['lessonId', 'lesson_id', 'id', 'recId'])
  if (id === '') return null
  const title = pickString(rec, ['title', 'lessonName', 'name', 'recName'])

  const streams = Array.isArray(rec.playUrls)
    ? (rec.playUrls as unknown[])
    : Array.isArray(rec.streams)
      ? (rec.streams as unknown[])
      : []

  let teacherStreamUrl: string | undefined
  let screenStreamUrl: string | undefined
  for (const s of streams) {
    if (s == null || typeof s !== 'object') continue
    const so = s as Record<string, unknown>
    const kind = pickString(so, ['type', 'streamType', 'channel', 'name'])
    const url = pickString(so, ['url', 'playUrl', 'hls', 'address'])
    if (url === '') continue
    if (kind.includes('1170193-1') || kind.toLowerCase().includes('teacher')) teacherStreamUrl = url
    else if (kind.includes('1170195-5') || kind.toLowerCase().includes('screen')) screenStreamUrl = url
    // 1170194-3 panorama: intentionally ignored.
  }

  if (teacherStreamUrl == null && typeof rec.teacherUrl === 'string') teacherStreamUrl = rec.teacherUrl
  if (screenStreamUrl == null && typeof rec.screenUrl === 'string') screenStreamUrl = rec.screenUrl

  const duration = pickNumber(rec, ['duration', 'durationSeconds', 'duration_seconds'])
  const startedAt = pickString(rec, ['startTime', 'startedAt', 'beginTime'])
  const pptCourseId = pickString(rec, ['pptCourseId', 'ppt_course_id'])

  return {
    id,
    courseId,
    title,
    ...(startedAt ? { startedAt } : {}),
    ...(duration != null ? { durationSeconds: duration } : {}),
    ...(teacherStreamUrl ? { teacherStreamUrl } : {}),
    ...(screenStreamUrl ? { screenStreamUrl } : {}),
    ...(pptCourseId ? { pptCourseId } : {})
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v !== '') return v
    if (typeof v === 'number') return String(v)
  }
  return ''
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return undefined
}
