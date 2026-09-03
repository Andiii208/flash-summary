import { describe, expect, it } from 'vitest'
import { SchoolClient, SchoolApiError } from '../src/main/school/client'

const API_BASE = 'https://cvs.seu.edu.cn/jy-application-resourcemanage'
const COURSE_LIST_URL = `${API_BASE}/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500`

interface FakeResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  url: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function jsonResponse(body: unknown, status = 200, url = 'https://cvs.seu.edu.cn/ok'): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    url,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

/** Replay-style fake fetch: maps request URL to a canned response. */
function makeFetch(routes: Record<string, FakeResponse>, capture?: { headers: Array<Record<string, string>> }) {
  const cap = capture
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    if (cap) cap.headers.push(init?.headers ?? {})
    const hit = routes[url]
    if (hit == null) throw new Error(`no fixture route for ${url}`)
    return hit
  }
}

describe('SchoolClient (fixture replay, field-calibrated endpoints)', () => {
  it('sends cookie + jwt-token headers and parses the wrapped course list', async () => {
    const captured: { headers: Array<Record<string, string>> } = { headers: [] }
    const client = new SchoolClient(
      API_BASE,
      async () => 'JSESSIONID=abc; route=r1',
      makeFetch(
        {
          [COURSE_LIST_URL]: jsonResponse({
            code: '0',
            result: { records: [{ courId: 'c1', courName: 'C++程序设计课程设计' }] }
          })
        },
        captured
      ),
      async () => 'jwt-token-value'
    )
    const courses = await client.listCourses()
    expect(captured.headers[0]?.Cookie).toBe('JSESSIONID=abc; route=r1')
    expect(captured.headers[0]?.['jwt-token']).toBe('jwt-token-value')
    expect(courses).toEqual([{ id: 'c1', name: 'C++程序设计课程设计' }])
  })

  it('parses the course list when result is a bare array', async () => {
    const client = new SchoolClient(
      API_BASE,
      async () => '',
      makeFetch({
        [COURSE_LIST_URL]: jsonResponse({ code: '0', result: [{ courId: 'c2', courName: '当代科技' }] })
      }),
      async () => ''
    )
    expect(await client.listCourses()).toEqual([{ id: 'c2', name: '当代科技' }])
  })

  it('parses lesson detail from a data-wrapped payload', async () => {
    const client = new SchoolClient(
      API_BASE,
      async () => 'JSESSIONID=abc',
      makeFetch({
        [`${API_BASE}/v1/course/rec/l1`]: jsonResponse({
          data: {
            id: 'l1',
            title: '第六讲',
            playUrls: [{ type: '1170195-5', url: 'http://media/screen.m3u8' }]
          }
        })
      })
    )
    const detail = await client.lessonDetail('l1', 'c1')
    expect(detail.id).toBe('l1')
    expect(detail.screenStreamUrl).toBe('http://media/screen.m3u8')
    expect(detail.teacherStreamUrl).toBeUndefined()
  })

  it('throws session_expired on a 302 redirect to CAS', async () => {
    const client = new SchoolClient(
      API_BASE,
      async () => 'JSESSIONID=stale',
      makeFetch({
        [COURSE_LIST_URL]: {
          ok: false,
          status: 302,
          headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://ids.seu.edu.cn/authserver/login?service=x' : null) },
          url: COURSE_LIST_URL,
          json: async () => ({}),
          text: async () => ''
        }
      })
    )
    await expect(client.listCourses()).rejects.toMatchObject({
      name: 'SchoolApiError',
      kind: 'session_expired'
    })
  })

  it('throws session_expired when the body is an HTML login page', async () => {
    const client = new SchoolClient(
      API_BASE,
      async () => 'JSESSIONID=stale',
      makeFetch({
        [COURSE_LIST_URL]: {
          ok: true,
          status: 200,
          headers: { get: () => null },
          url: COURSE_LIST_URL,
          json: async () => {
            throw new Error('not json')
          },
          text: async () => '<html><body>authserver login</body></html>'
        }
      })
    )
    await expect(client.listCourses()).rejects.toMatchObject({ kind: 'session_expired' })
  })

  it('throws bad_response on HTTP 500', async () => {
    const client = new SchoolClient(
      API_BASE,
      async () => '',
      makeFetch({
        [COURSE_LIST_URL]: jsonResponse({ error: 'boom' }, 500)
      })
    )
    await expect(client.listCourses()).rejects.toMatchObject({ kind: 'bad_response' })
  })

  it('throws network on transport failure', async () => {
    const client = new SchoolClient(API_BASE, async () => '', async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(client.listCourses()).rejects.toMatchObject({ kind: 'network' })
  })

  it('lists PPT urls from array or object payloads', async () => {
    const client = new SchoolClient(
      API_BASE,
      async () => 'C=1',
      makeFetch({
        [`${API_BASE}/v1/course/ai/ppt?courseId=c1`]: jsonResponse([
          'http://a/1.png',
          { url: 'http://a/2.png' },
          { nope: true }
        ])
      })
    )
    expect(await client.listPpt('c1')).toEqual(['http://a/1.png', 'http://a/2.png'])
  })
})

describe('SchoolClient.listCoursesPaged (B1: capped pagination)', () => {
  function pageEnvelope(pageIndex: number, pageCount: number, ids: string[]): unknown {
    return {
      code: null,
      data: { records: ids.map((id) => ({ id, subjName: `课${id}` })), pageIndex, pageCount }
    }
  }

  it('walks pages up to the cap and reports progress + platform totals', async () => {
    const progress: Array<{ page: number; pageCount: number }> = []
    const client = new SchoolClient(
      API_BASE,
      async () => 'C=1',
      makeFetch({
        [`${API_BASE}/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500`]: jsonResponse(pageEnvelope(1, 648, ['a'])),
        [`${API_BASE}/v1/group_subject_vod_list/t-1?page.pageIndex=2&page.pageSize=500`]: jsonResponse(pageEnvelope(2, 648, ['b'])),
        [`${API_BASE}/v1/group_subject_vod_list/t-1?page.pageIndex=3&page.pageSize=500`]: jsonResponse(pageEnvelope(3, 648, ['c']))
      })
    )
    const result = await client.listCoursesPaged({ maxPages: 2, onProgress: (p) => progress.push(p) })
    expect(result.courses.map((c) => c.id)).toEqual(['a', 'b'])
    expect(result.fetchedPages).toBe(2)
    expect(result.platformPages).toBe(648)
    expect(result.platformTotal).toBe(648 * 500)
    expect(progress).toEqual([
      { page: 1, pageCount: 2 },
      { page: 2, pageCount: 2 }
    ])
  })

  it('stops at the platform page count when it is below the cap', async () => {
    const client = new SchoolClient(
      API_BASE,
      async () => '',
      makeFetch({
        [`${API_BASE}/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500`]: jsonResponse(pageEnvelope(1, 1, ['only']))
      })
    )
    const result = await client.listCoursesPaged({ maxPages: 4 })
    expect(result.courses.map((c) => c.id)).toEqual(['only'])
    expect(result.fetchedPages).toBe(1)
  })

  it('listCourses keeps the single-page shape for probe/tests', async () => {
    const client = new SchoolClient(
      API_BASE,
      async () => '',
      makeFetch({
        [`${API_BASE}/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500`]: jsonResponse(pageEnvelope(1, 648, ['a']))
      })
    )
    expect(await client.listCourses()).toEqual([{ id: 'a', name: '课a' }])
  })
})

describe('SchoolApiError kinds drive user-facing messages', () => {
  it('exposes machine-readable kinds', () => {
    expect(new SchoolApiError('session_expired', 'x').kind).toBe('session_expired')
    expect(new SchoolApiError('network', 'x').kind).toBe('network')
    expect(new SchoolApiError('bad_response', 'x').kind).toBe('bad_response')
  })
})
