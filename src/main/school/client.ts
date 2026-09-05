import {
  isCasLoginRedirect,
  parseCourseList,
  parseCoursePageCount,
  parseLessonDetail,
  type CourseSummary,
  type LessonDetail
} from './api-parse'

/** Page size of the platform course list (field-calibrated: 500/page). */
const PAGE_SIZE = 500
/**
 * Default page cap for a refresh. t-1 is the whole-school catalog (hundreds
 * of pages) — fetching everything is infeasible and the «我的课程» work
 * targets the user's own slice; the cap is user-tunable via the
 * `courseListMaxPages` setting.
 */
const DEFAULT_MAX_PAGES = 4

function courseListPath(pageIndex: number): string {
  return `/v1/group_subject_vod_list/t-1?page.pageIndex=${pageIndex}&page.pageSize=${PAGE_SIZE}`
}

/** Progress of a paged course refresh (x of the pages we will fetch). */
export interface CourseListProgress {
  page: number
  pageCount: number
}

export interface CoursePageResult {
  courses: CourseSummary[]
  /** Pages the platform reports (pageCount). */
  platformPages: number
  /** Pages actually fetched (capped by maxPages). */
  fetchedPages: number
  /** Approximate total course count the platform reports. */
  platformTotal: number
}

/**
 * School API client over an injectable fetch. Every request carries the
 * session cookie header; responses are parsed by pure functions from
 * api-parse.ts so fixtures can be replayed in tests.
 */
export class SchoolApiError extends Error {
  readonly kind: 'session_expired' | 'network' | 'bad_response'

  constructor(kind: 'session_expired' | 'network' | 'bad_response', message: string) {
    super(message)
    this.name = 'SchoolApiError'
    this.kind = kind
  }
}

export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string>; redirect?: 'manual' | 'follow'; signal?: AbortSignal }): Promise<{
    ok: boolean
    status: number
    headers: { get(name: string): string | null }
    url: string
    json: () => Promise<unknown>
    text: () => Promise<string>
  }>
}

/** Hard deadline for one school API request (review 2026-09-05 A7). */
export const SCHOOL_TIMEOUT_MS = 30_000

export class SchoolClient {
  constructor(
    /** API base, e.g. https://cvs.seu.edu.cn/jy-application-resourcemanage */
    private readonly baseUrl: string,
    private readonly getCookie: () => Promise<string>,
    private readonly fetchImpl: FetchLike,
    /** Platform JWT provider; sent as the `jwt-token` header (U: field-calibrated). */
    private readonly getJwt?: () => Promise<string>,
    /** Injectable for tests; production default keeps a hung socket from pinning the UI. */
    private readonly timeoutMs: number = SCHOOL_TIMEOUT_MS
  ) {}

  private async request(path: string): Promise<unknown> {
    const cookie = await this.getCookie()
    const jwt = (await this.getJwt?.()) ?? ''
    const headers: Record<string, string> = {}
    if (cookie !== '') headers.Cookie = cookie
    if (jwt !== '') headers['jwt-token'] = jwt
    let res
    // Double-guarded deadline: the AbortSignal cancels the socket when the
    // transport honors it, and the Promise.race guarantees this call returns
    // even when a Chromium-stack fetch ignores the signal (2026-09-04 field
    // lesson from the ASR probe). One hung request must not pin the queue.
    const signal = AbortSignal.timeout(this.timeoutMs)
    let timer: NodeJS.Timeout | undefined
    try {
      res = await Promise.race([
        this.fetchImpl(`${this.baseUrl}${path}`, { headers, redirect: 'manual', signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new SchoolApiError('network', `school API timeout after ${Math.round(this.timeoutMs / 1000)}s for ${path}`)),
            this.timeoutMs
          )
        })
      ])
    } catch (err) {
      if (err instanceof SchoolApiError) throw err
      throw new SchoolApiError('network', `network error contacting ${this.baseUrl}: ${(err as Error).message}`)
    } finally {
      if (timer != null) clearTimeout(timer)
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') ?? ''
      if (isCasLoginRedirect(location)) throw new SchoolApiError('session_expired', 'school session expired (redirect to CAS)')
    }
    if (isCasLoginRedirect(res.url)) throw new SchoolApiError('session_expired', 'school session expired (landed on CAS page)')
    // Field 2026-09-03: the jwt-token era platform answers a sessionless
    // request with a bare 401 JSON instead of a CAS redirect — that must
    // read as session_expired so withSessionRetry re-opens the login.
    if (res.status === 401) throw new SchoolApiError('session_expired', `school session expired (HTTP 401 for ${path})`)
    if (!res.ok) throw new SchoolApiError('bad_response', `school API returned ${res.status} for ${path}`)

    const text = await res.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      if (isCasLoginRedirect(text.slice(0, 2048))) {
        throw new SchoolApiError('session_expired', 'school session expired (login page returned)')
      }
      throw new SchoolApiError('bad_response', `school API returned non-JSON for ${path}`)
    }
  }

  async listCourses(): Promise<CourseSummary[]> {
    // Field-calibrated endpoint (2026-09): cloud-classroom VOD list, tenant
    // group t-1, paged. Single page — kept for the probe path and tests.
    return (await this.listCoursesPaged({ maxPages: 1 })).courses
  }

  /**
   * Paged refresh (B1): walk the platform's course pages up to maxPages,
   * reporting progress per page. platformTotal comes from the platform's
   * own pageCount so the UI can state the loaded/total boundary honestly.
   */
  async listCoursesPaged(
    options: { maxPages?: number; onProgress?: (p: CourseListProgress) => void } = {}
  ): Promise<CoursePageResult> {
    const maxPages = Math.max(1, Math.floor(options.maxPages ?? DEFAULT_MAX_PAGES))
    const first = await this.request(courseListPath(1))
    const courses = parseCourseList(first)
    const platformPages = Math.max(1, parseCoursePageCount(first))
    const targetPages = Math.min(platformPages, maxPages)
    options.onProgress?.({ page: 1, pageCount: targetPages })
    for (let pageIndex = 2; pageIndex <= targetPages; pageIndex++) {
      courses.push(...parseCourseList(await this.request(courseListPath(pageIndex))))
      options.onProgress?.({ page: pageIndex, pageCount: targetPages })
    }
    return { courses, platformPages, fetchedPages: targetPages, platformTotal: platformPages * PAGE_SIZE }
  }

  async lessonDetail(lessonId: string, courseId: string): Promise<LessonDetail> {
    const detail = parseLessonDetail(await this.request(`/v1/course/rec/${encodeURIComponent(lessonId)}`), courseId)
    if (detail == null) throw new SchoolApiError('bad_response', `lesson ${lessonId} payload missing id`)
    return detail
  }

  /** PPT image list for a course (platform PPT is the primary visual source). */
  async listPpt(courseId: string): Promise<string[]> {
    const payload = await this.request(`/v1/course/ai/ppt?courseId=${encodeURIComponent(courseId)}`)
    const urls: string[] = []
    if (Array.isArray(payload)) {
      for (const item of payload) {
        if (typeof item === 'string') urls.push(item)
        else if (item != null && typeof item === 'object') {
          const u = (item as Record<string, unknown>)['url']
          if (typeof u === 'string') urls.push(u)
        }
      }
    }
    return urls
  }
}
