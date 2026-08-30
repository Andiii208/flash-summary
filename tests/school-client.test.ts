import { describe, expect, it } from 'vitest'
import { SchoolClient, SchoolApiError } from '../src/main/school/client'

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
function makeFetch(routes: Record<string, FakeResponse>, capture?: { cookies: string[] }) {
  const cap = capture
  return async (url: string, init?: { headers?: Record<string, string> }) => {
    if (cap) cap.cookies.push(init?.headers?.Cookie ?? '')
    const hit = routes[url]
    if (hit == null) throw new Error(`no fixture route for ${url}`)
    return hit
  }
}

describe('SchoolClient (fixture replay)', () => {
  it('sends the session cookie and parses the course list', async () => {
    const captured: { cookies: string[] } = { cookies: [] }
    const client = new SchoolClient(
      'https://cvs.seu.edu.cn',
      async () => 'JSESSIONID=abc; CASTGT=t1',
      makeFetch(
        {
          'https://cvs.seu.edu.cn/v1/course/list': jsonResponse({
            list: [{ courseId: 'c1', courseName: '高等数学' }]
          })
        },
        captured
      )
    )
    const courses = await client.listCourses()
    expect(captured.cookies[0]).toBe('JSESSIONID=abc; CASTGT=t1')
    expect(courses).toEqual([{ id: 'c1', name: '高等数学' }])
  })

  it('parses lesson detail from a data-wrapped payload', async () => {
    const client = new SchoolClient(
      'https://cvs.seu.edu.cn',
      async () => 'JSESSIONID=abc',
      makeFetch({
        'https://cvs.seu.edu.cn/v1/course/rec/l1': jsonResponse({
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
      'https://cvs.seu.edu.cn',
      async () => 'JSESSIONID=stale',
      makeFetch({
        'https://cvs.seu.edu.cn/v1/course/list': {
          ok: false,
          status: 302,
          headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://ids.seu.edu.cn/authserver/login?service=x' : null) },
          url: 'https://cvs.seu.edu.cn/v1/course/list',
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
      'https://cvs.seu.edu.cn',
      async () => 'JSESSIONID=stale',
      makeFetch({
        'https://cvs.seu.edu.cn/v1/course/list': {
          ok: true,
          status: 200,
          headers: { get: () => null },
          url: 'https://cvs.seu.edu.cn/v1/course/list',
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
      'https://cvs.seu.edu.cn',
      async () => '',
      makeFetch({
        'https://cvs.seu.edu.cn/v1/course/list': jsonResponse({ error: 'boom' }, 500)
      })
    )
    await expect(client.listCourses()).rejects.toMatchObject({ kind: 'bad_response' })
  })

  it('throws network on transport failure', async () => {
    const client = new SchoolClient('https://cvs.seu.edu.cn', async () => '', async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(client.listCourses()).rejects.toMatchObject({ kind: 'network' })
  })

  it('lists PPT urls from array or object payloads', async () => {
    const client = new SchoolClient(
      'https://cvs.seu.edu.cn',
      async () => 'C=1',
      makeFetch({
        'https://cvs.seu.edu.cn/v1/course/ai/ppt?courseId=c1': jsonResponse([
          'http://a/1.png',
          { url: 'http://a/2.png' },
          { nope: true }
        ])
      })
    )
    expect(await client.listPpt('c1')).toEqual(['http://a/1.png', 'http://a/2.png'])
  })
})

describe('SchoolApiError kinds drive user-facing messages', () => {
  it('exposes machine-readable kinds', () => {
    expect(new SchoolApiError('session_expired', 'x').kind).toBe('session_expired')
    expect(new SchoolApiError('network', 'x').kind).toBe('network')
    expect(new SchoolApiError('bad_response', 'x').kind).toBe('bad_response')
  })
})
