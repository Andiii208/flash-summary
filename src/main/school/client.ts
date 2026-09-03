import {
  isCasLoginRedirect,
  parseCourseList,
  parseLessonDetail,
  type CourseSummary,
  type LessonDetail
} from './api-parse'

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
  (url: string, init?: { headers?: Record<string, string>; redirect?: 'manual' | 'follow' }): Promise<{
    ok: boolean
    status: number
    headers: { get(name: string): string | null }
    url: string
    json: () => Promise<unknown>
    text: () => Promise<string>
  }>
}

export class SchoolClient {
  constructor(
    /** API base, e.g. https://cvs.seu.edu.cn/jy-application-resourcemanage */
    private readonly baseUrl: string,
    private readonly getCookie: () => Promise<string>,
    private readonly fetchImpl: FetchLike,
    /** Platform JWT provider; sent as the `jwt-token` header (U: field-calibrated). */
    private readonly getJwt?: () => Promise<string>
  ) {}

  private async request(path: string): Promise<unknown> {
    const cookie = await this.getCookie()
    const jwt = (await this.getJwt?.()) ?? ''
    const headers: Record<string, string> = {}
    if (cookie !== '') headers.Cookie = cookie
    if (jwt !== '') headers['jwt-token'] = jwt
    let res
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers,
        redirect: 'manual'
      })
    } catch (err) {
      throw new SchoolApiError('network', `network error contacting ${this.baseUrl}: ${(err as Error).message}`)
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
    // group t-1, paged. The page size covers a full semester in one call.
    const payload = await this.request('/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500')
    return parseCourseList(payload)
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
