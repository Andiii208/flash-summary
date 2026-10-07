/**
 * Pure helpers for school API responses and session state.
 *
 * Kept side-effect free so they can be unit-tested against recorded fixtures
 * without any network access.
 */
import type { TermOption } from '../../shared/bridge'
import { termOrdinal } from '../../shared/course-display'

/**
 * H30 (audit 2026-09-28): 已知 CAS/SSO 主机清单——这些主机上出现的任何 URL
 * 都是登录流程的一跳（平台未登录时会 302 去 ids.seu.edu.cn 的 authserver）。
 * **不含 auth.seu.edu.cn**：那是 OAuth 授权中转站，登录轮询的正常路径就会
 * 经过它（main-window-login 的 away-and-back、play 收割的静默 SSO），整站判
 * 「会话过期」会把正常跳转误报成掉登录。
 */
const CAS_LOGIN_HOST_SUFFIXES = ['ids.seu.edu.cn']

/**
 * 登录页路径段：整段相等才算（路径段级匹配）。旧实现是 `/cas|login|sso` 子串
 * 扫描，`/login-page`、`/api/login-history` 这类正常路由都会被误杀。
 */
const CAS_LOGIN_PATH_SEGMENTS = ['cas', 'login', 'sso', 'authserver']

/**
 * 非 URL 原文（client.ts 会把 2xx 的 HTML 登录页正文喂进来）的降级判定：
 * 只认路径形态（`/authserver/…`、`/cas/login`）与 authserver 字样。
 */
const LOGIN_MARKER_IN_TEXT = /\/(?:cas|login|sso|authserver)\b|\bauthserver\b/i

/**
 * True when the app was redirected to the CAS login page (session expired).
 *
 * H30: 收紧前这条正则是 `/\/(cas|login|sso)\b|ids\.seu\.edu\.cn|authserver/i`
 * 全串扫描——任何含 login 的查询串（`?redirect=…`）、任何路径里出现
 * authserver 的 URL 都被判「会话过期」，触发无谓重登录。现在：
 *   1. 能解析成 URL 的：命中已知 CAS 主机 → true；否则只看**路径与 hash 段**
 *      （平台 SPA 是 hash 路由），查询串不算，除非里面嵌了完整登录 URL
 *      （字符串含已知 CAS 主机）；
 *   2. 解析不成 URL 的（HTML 正文）：退化为路径形态与 authserver 字样匹配。
 */
export function isCasLoginRedirect(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return LOGIN_MARKER_IN_TEXT.test(url)
  }
  // 已知 CAS 主机（含子域）上任何路径都是登录流程。
  if (CAS_LOGIN_HOST_SUFFIXES.some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`))) return true
  // 查询里嵌了完整的登录 URL（SSO 回跳常带 redirect=/authserver/…）也算。
  if (CAS_LOGIN_HOST_SUFFIXES.some((host) => url.includes(host))) return true
  const segments = `${parsed.pathname}${parsed.hash}`.toLowerCase().split(/[/?#]+/)
  return segments.some((segment) => CAS_LOGIN_PATH_SEGMENTS.includes(segment))
}

export interface CourseSummary {
  id: string
  name: string
  /**
   * Canonical `YYYY-YYYY-N` (academic year + platform term number), e.g.
   * `2026-2027-2`. Legacy rows harvested before 2026-10-07 carry the
   * year range only (`2026-2027`) — the term number arrived with the
   * `acteId` semester filter (plan 2026-10-07).
   */
  term?: string
  teacher?: string
  /** Recording-class id for the play-page route (live t-1 field, 2026-09). */
  teclId?: string
  /** Recording-class code for the play-page route (live t-1 field, 2026-09). */
  teclCode?: string
  /** Subject code: shared across a subject's sections/teachers (C1). */
  subjCode?: string
  /** Classroom of the recording class (live t-1 field clroName, C3). */
  classroom?: string
  /** Meeting times as the platform writes them (live t-1 field courTimes, C3). */
  courTimes?: string
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
 * Best-effort: find the record array inside a platform envelope. The
 * cloud-classroom API (field-calibrated 2026-09) wraps pages as
 * {code,result:{records|list|rows|data}} or returns a bare array;
 * tolerate every observed shape. Shared by the course list and the term
 * catalog (both verified live 2026-10-07).
 */
function findRecordArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (payload == null || typeof payload !== 'object') return []
  const obj = payload as Record<string, unknown>
  const levels: unknown[] = [obj.result, obj.data, obj]
  for (const level of levels) {
    if (Array.isArray(level)) return level
    if (level != null && typeof level === 'object') {
      const inner = level as Record<string, unknown>
      for (const key of ['records', 'list', 'rows', 'data', 'resources']) {
        if (Array.isArray(inner[key])) return inner[key] as unknown[]
      }
    }
  }
  return []
}

/**
 * Total pages the platform reports for the course list. The live t-1
 * envelope carries {data:{records,pageIndex,pageCount}}; tolerate the
 * result wrapper and numeric strings. 1 when nothing readable is found
 * (single page).
 */
export function parseCoursePageCount(payload: unknown): number {
  if (payload == null || typeof payload !== 'object') return 1
  const obj = payload as Record<string, unknown>
  for (const level of [obj.data, obj.result, obj]) {
    if (level == null || typeof level !== 'object') continue
    const inner = level as Record<string, unknown>
    for (const key of ['pageCount', 'totalPages', 'totalPage']) {
      const v = inner[key]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 1) return v
      if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 1) return Number(v)
    }
  }
  return 1
}

/**
 * Parse the course list payload. Field names come from the cloud-classroom
 * front-end; the 2026-09-02 live sample (t-1 envelope {code,data:{records}})
 * carries subjName / teacNames[] / acyeBeginYear+acyeEndYear. Older shapes
 * stay as candidates; unknown fields map to ''.
 */
export function parseCourseList(payload: unknown): CourseSummary[] {
  const list = findRecordArray(payload)
  return list
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => {
      const id = pickString(item, ['courId', 'courseId', 'course_id', 'id', 'courseNo', 'resId'])
      const name = pickString(item, ['subjName', 'courName', 'courseName', 'course_name', 'name', 'title'])
      const term = buildTerm(item) ||
        pickString(item, ['acyeName', 'term', 'semester', 'termName', 'yearName'])
      const teacher = pickString(item, ['teacher', 'teacherName', 'lecturer', 'speakerName']) ||
        pickStringArray(item, ['teacNames', 'teacherNames'])
      const teclId = pickString(item, ['teclId', 'tecl_id'])
      const teclCode = pickString(item, ['teclCode', 'tecl_code'])
      const subjCode = pickString(item, ['subjCode', 'subj_code', 'subjectCode'])
      const classroom = pickString(item, ['clroName', 'classroom', 'classRoom'])
      const courTimes = pickString(item, ['courTimes', 'cour_times']) || pickStringArray(item, ['courTimes', 'cour_times'])
      return {
        id,
        name,
        ...(term ? { term } : {}),
        ...(teacher ? { teacher } : {}),
        ...(teclId !== '' ? { teclId } : {}),
        ...(teclCode !== '' ? { teclCode } : {}),
        ...(subjCode !== '' ? { subjCode } : {}),
        ...(classroom !== '' ? { classroom } : {}),
        ...(courTimes !== '' ? { courTimes } : {})
      }
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

/** First string[] field joined with '、' (real t-1 teachers arrive as arrays). */
function pickStringArray(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) {
      const joined = (v as string[]).join('、')
      if (joined !== '') return joined
    }
  }
  return ''
}

/** "2026-2027" from the real t-1 academic-year fields, if present. */
function pickYearRange(obj: Record<string, unknown>): string {
  const begin = obj.acyeBeginYear
  const end = obj.acyeEndYear
  if (typeof begin === 'number' && typeof end === 'number') return `${begin}-${end}`
  return ''
}

/**
 * Canonical term for a course list record: `YYYY-YYYY-N` from the live
 * acyeBeginYear/acyeEndYear + acteName trio (all three present in the
 * real t-1 payload since 2026-09, field sample 2026-10-07). Falls back to
 * the year range alone when the term number is missing — that shape is
 * what legacy rows carry.
 */
function buildTerm(obj: Record<string, unknown>): string {
  const yearRange = pickYearRange(obj)
  if (yearRange === '') return ''
  const termNumber = pickString(obj, ['acteName', 'term', 'semester'])
  return termNumber === '' ? yearRange : `${yearRange}-${termNumber}`
}

/**
 * Parse the platform term catalog (`/v1/list/termYear`, verified live
 * 2026-10-07: a bare array of {id, acyeCode, acteTerm, currentTerm,
 * acteBeginDate, acteEndDate}). Records without a usable id or year are
 * dropped — a semester the refresh cannot filter on is worse than absent.
 */
export function parseTermList(payload: unknown): TermOption[] {
  return findRecordArray(payload)
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => {
      const academicYear = pickString(item, ['acyeCode', 'acyeName', 'yearName'])
      const term = pickNumber(item, ['acteTerm', 'term']) ?? 0
      return {
        id: pickNumber(item, ['id', 'acteId']) ?? 0,
        academicYear,
        term,
        currentTerm: item.currentTerm === true,
        label: academicYear === '' ? '' : `${academicYear} ${termOrdinal(term)}学期`
      }
    })
    .filter((t) => t.id > 0 && t.academicYear !== '')
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return undefined
}
