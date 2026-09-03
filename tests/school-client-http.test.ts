import { describe, expect, it, afterEach } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { SchoolClient, SchoolApiError } from '../src/main/school/client'

/**
 * Integration layer (combined audit 2026-09-02): SchoolClient over the REAL
 * globalThis.fetch (the same impl app-context injects) against a local
 * node:http server. The unit suite replays fixture responses; here the
 * actual fetch -> TLS-free HTTP -> header -> parser composition is verified.
 */

const CAS_LOGIN_HTML =
  '<html><head><title>统一身份认证</title></head><body>authserver login form ids.seu.edu.cn</body></html>'

interface CapturedRequest {
  url: string
  headers: IncomingMessage['headers']
}

let server: Server | null = null
let captured: CapturedRequest[] = []

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server == null) return resolve()
    server.close(() => resolve())
    server.closeAllConnections()
  })
  server = null
  captured = []
})

/** Start a local server whose responses are driven per-request. */
function startServer(
  respond: (req: IncomingMessage, res: ServerResponse, index: number) => void
): Promise<string> {
  captured = []
  let seen = 0
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      captured.push({ url: req.url ?? '', headers: req.headers })
      respond(req, res, seen++)
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server!.address() as AddressInfo
      resolve(`http://127.0.0.1:${port}/jy-application-resourcemanage`)
    })
  })
}

function makeClient(baseUrl: string): SchoolClient {
  return new SchoolClient(
    baseUrl,
    async () => 'JSESSIONID=live; route=r1',
    (url, init) => globalThis.fetch(url, init as RequestInit),
    async () => 'jwt-live-value'
  )
}

describe('SchoolClient over real fetch (local http server)', () => {
  it('round-trips headers and parses the t-1 course list from real HTTP', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({ code: '0', result: { records: [{ courId: 'c9', courName: '数据结构', teacher: '王老师' }] } })
      )
    })
    const courses = await makeClient(base).listCourses()

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('/jy-application-resourcemanage/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=500')
    expect(captured[0].headers.cookie).toBe('JSESSIONID=live; route=r1')
    expect(captured[0].headers['jwt-token']).toBe('jwt-live-value')
    expect(courses).toEqual([{ id: 'c9', name: '数据结构', teacher: '王老师' }])
  })

  it('classifies a redirect to the CAS page as session_expired', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(302, { location: 'https://auth.seu.edu.cn/authserver/login?service=x' })
      res.end()
    })
    const err = await makeClient(base)
      .listCourses()
      .then(
        () => null,
        (e: unknown) => e
      )
    expect(err).toBeInstanceOf(SchoolApiError)
    expect((err as SchoolApiError).kind).toBe('session_expired')
  })

  it('classifies a 200 HTML login page as session_expired', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(CAS_LOGIN_HTML)
    })
    await expect(makeClient(base).listCourses()).rejects.toMatchObject({
      name: 'SchoolApiError',
      kind: 'session_expired'
    })
  })

  it('classifies HTTP 500 as bad_response', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{"error":"boom"}')
    })
    await expect(makeClient(base).listCourses()).rejects.toMatchObject({ kind: 'bad_response' })
  })

  it('classifies a bare 401 JSON as session_expired (jwt-token era platform, field 2026-09-03)', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end('{"code":"401","message":"unauthorized"}')
    })
    await expect(makeClient(base).listCourses()).rejects.toMatchObject({
      name: 'SchoolApiError',
      kind: 'session_expired'
    })
  })

  it('classifies a non-JSON 200 body as bad_response', async () => {
    const base = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('not json at all')
    })
    await expect(makeClient(base).listCourses()).rejects.toMatchObject({ kind: 'bad_response' })
  })

  it('classifies a refused connection as network', async () => {
    // Port 1 on loopback: nothing listens there; no external traffic.
    const client = makeClient('http://127.0.0.1:1/jy-application-resourcemanage')
    await expect(client.listCourses()).rejects.toMatchObject({
      name: 'SchoolApiError',
      kind: 'network'
    })
  })
})
