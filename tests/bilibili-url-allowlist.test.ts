import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import {
  assertAllowedBilibiliUrl,
  BILIBILI_ALLOWED_HOSTS,
  BilibiliClient,
  isAllowedBilibiliUrl,
  type FetchLike
} from '../src/main/bilibili/client'

/**
 * H1 (audit 2026-09-28): B 站出站白名单的取证测试。
 *
 * 攻击面复现：player 接口响应体里的 subtitle_url / view 接口响应体里的封面
 * pic / 渲染层原样透传的短链——三者的 host 都不是这个 client 自己拼的。这里用
 * 一台本地 http server 当「B 站 API 面」（白名单显式注入放行），让响应体把
 * 字幕轨指向外部主机，钉住三件事：带 cookie 的请求被拒、cookie 没发出、
 * 白名单内正常路径照旧。
 */

const BVID = 'BV1ALLOW0001'
const PLAYER_PATH = '/bapi/x/player/wbi/v2'
const SUBTITLE_PATH = '/subtitle.json'
const COVER_PATH = '/cover.png'
/** player 响应体指定的「字幕轨」——H1 里它就是那个外部主机。 */
const FOREIGN_SUBTITLE_URL = 'https://sub.evil.example.com/track.json'

const SUBTITLE_BODY = { body: [{ from: 0.2, to: 3, content: '白名单内字幕' }] }

interface RecordedRequest {
  url: string
  cookie: string | null
}

let server: Server | null = null
let port = 0
let recorded: RecordedRequest[] = []

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? ''
  recorded.push({ url, cookie: req.headers.cookie ?? null })
  if (url.startsWith(PLAYER_PATH)) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        code: 0,
        data: {
          need_login_subtitle: true,
          subtitle: { subtitles: [{ lan: 'ai-zh', ai_type: 1, subtitle_url: FOREIGN_SUBTITLE_URL }] }
        }
      })
    )
    return
  }
  if (url === SUBTITLE_PATH) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(SUBTITLE_BODY))
    return
  }
  if (url === COVER_PATH) {
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    return
  }
  res.writeHead(404)
  res.end('not found')
}

/** 本地 fake server 的显式白名单条目：scheme 必须写出来（默认集合是 https-only）。 */
const LOCAL_ALLOW = ['http://127.0.0.1']

const realFetch: FetchLike = (url, init) => globalThis.fetch(url, init as RequestInit)

function localClient(cookie = 'SESSDATA=abc'): BilibiliClient {
  return new BilibiliClient(async () => cookie, realFetch, 10_000, `http://127.0.0.1:${port}/bapi`, `http://127.0.0.1:${port}/bapi`, LOCAL_ALLOW)
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer(handle)
    server.listen(0, '127.0.0.1', () => {
      port = (server!.address() as { port: number }).port
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server == null) return resolve()
    server.close(() => resolve())
    server.closeAllConnections()
  })
})

beforeEach(() => {
  recorded = []
})

afterEach(() => {
  recorded = []
})

describe('isAllowedBilibiliUrl — 白名单判定（纯函数）', () => {
  it('默认集合放行 B 站官方域名与 CDN 后缀域', () => {
    expect(isAllowedBilibiliUrl('https://api.bilibili.com/x/web-interface/view', BILIBILI_ALLOWED_HOSTS)).toBe(true)
    expect(isAllowedBilibiliUrl('https://www.bilibili.com/video/BV1xx', BILIBILI_ALLOWED_HOSTS)).toBe(true)
    expect(isAllowedBilibiliUrl('https://passport.bilibili.com/x', BILIBILI_ALLOWED_HOSTS)).toBe(true)
    expect(isAllowedBilibiliUrl('https://b23.tv/abc123', BILIBILI_ALLOWED_HOSTS)).toBe(true)
    // D1（决策项已裁「含」）：CDN 主机按现场取证就是 cover/subtitle 的落点，
    // .bilivideo.cn 与 .bilivideo.com 两个后缀都真实出现过（见集合注释）。
    expect(isAllowedBilibiliUrl('https://i0.hdslb.com/bfs/archive/cover.jpg', BILIBILI_ALLOWED_HOSTS)).toBe(true)
    expect(isAllowedBilibiliUrl('https://cdn.bilivideo.com/upstream/x.mp4', BILIBILI_ALLOWED_HOSTS)).toBe(true)
    expect(isAllowedBilibiliUrl('https://upos-sz-mirrorcos.bilivideo.com/xxx', BILIBILI_ALLOWED_HOSTS)).toBe(true)
    expect(isAllowedBilibiliUrl('https://xy.mcdn.bilivideo.cn:8082/v1', BILIBILI_ALLOWED_HOSTS)).toBe(true)
    expect(isAllowedBilibiliUrl('https://xyz.akamaized.net/v.mp4', BILIBILI_ALLOWED_HOSTS)).toBe(true)
  })

  it('后缀匹配要求前导点：相邻租用域名与后缀拼接受拒', () => {
    // 核心：没有前导点的 endsWith 会把「结尾恰好是白名单字符串」的域名放进来。
    expect(isAllowedBilibiliUrl('https://evilb23.tv/x', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    expect(isAllowedBilibiliUrl('https://evilhdslb.com/x', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    // 白名单条目的域被别人当前缀同样不命中。
    expect(isAllowedBilibiliUrl('https://hdslb.com.evil.com/x', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    expect(isAllowedBilibiliUrl('https://b23.tv.evil.com/x', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    expect(isAllowedBilibiliUrl('https://evil.com/b23.tv/x', BILIBILI_ALLOWED_HOSTS)).toBe(false)
  })

  it('scheme 只放行 https（http 明文直连不带 cookie 也要拒）', () => {
    expect(isAllowedBilibiliUrl('http://api.bilibili.com/x', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    expect(isAllowedBilibiliUrl('ftp://i0.hdslb.com/x', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    expect(isAllowedBilibiliUrl('data:text/html,hi', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    // 注入项显式写 scheme 才放行该 scheme（测试 fake server 的 http 缝）。
    expect(isAllowedBilibiliUrl('http://127.0.0.1:1/bapi/x', LOCAL_ALLOW)).toBe(true)
    expect(isAllowedBilibiliUrl('https://127.0.0.1:1/bapi/x', LOCAL_ALLOW)).toBe(false)
  })

  it('不可解析的输入一律拒绝（宁可拒错也不放过）', () => {
    expect(isAllowedBilibiliUrl('not a url', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    expect(isAllowedBilibiliUrl('', BILIBILI_ALLOWED_HOSTS)).toBe(false)
    expect(() => assertAllowedBilibiliUrl('::::', BILIBILI_ALLOWED_HOSTS)).toThrowError(/无法解析/)
  })

  it('assertAllowedBilibiliUrl 的拒绝原因区分 host 与 scheme', () => {
    expect(() => assertAllowedBilibiliUrl('https://evil.com/x', BILIBILI_ALLOWED_HOSTS)).toThrowError(
      /请求主机不在 B 站域名白名单内/
    )
    expect(() => assertAllowedBilibiliUrl('http://api.bilibili.com/x', BILIBILI_ALLOWED_HOSTS)).toThrowError(/只允许 https/)
    const err = ((): unknown => {
      try {
        assertAllowedBilibiliUrl('https://evil.com/x', BILIBILI_ALLOWED_HOSTS)
        return null
      } catch (e) {
        return e
      }
    })() as { kind?: string }
    expect(err.kind).toBe('blocked_host')
  })
})

describe('fetchSubtitleBody: 响应体指定的外部主机带 cookie 请求被拒（H1 取证）', () => {
  it('subtitle_url 指向外部主机时请求被拒、cookie 未发出、凭据读取都没发生', async () => {
    let cookieReads = 0
    const client = new BilibiliClient(
      async () => {
        cookieReads += 1
        return 'SESSDATA=abc'
      },
      realFetch,
      10_000,
      `http://127.0.0.1:${port}/bapi`,
      `http://127.0.0.1:${port}/bapi`,
      LOCAL_ALLOW
    )

    // 走真实路径：先拿字幕轨列表（这一步允许，host 是注入放行的本地 API 面）。
    const { subtitles } = await client.subtitleTracks(BVID, 1)
    const subtitleUrl = subtitles[0]?.subtitle_url
    expect(subtitleUrl).toBe(FOREIGN_SUBTITLE_URL)
    const requestsAfterTracks = recorded.length

    await expect(client.fetchSubtitleBody(subtitleUrl ?? '')).rejects.toMatchObject({ kind: 'blocked_host' })

    // 取证：外部主机一个字节都没被请求；白名单内那次请求带了 cookie（那是它
    // 该去的地方），而凭据读取在拒绝前就短路了——cookie 从头到尾没为外部主机
    // 出现过。
    expect(recorded.length).toBe(requestsAfterTracks)
    expect(recorded.some((r) => r.url.startsWith(SUBTITLE_PATH))).toBe(false)
    expect(recorded.some((r) => r.cookie !== null && !r.url.startsWith(PLAYER_PATH))).toBe(false)
    expect(cookieReads).toBe(1)
  })

  it('白名单内的字幕地址照常下载并带上 cookie（happy path 回归）', async () => {
    const client = localClient('SESSDATA=happy')
    const segments = await client.fetchSubtitleBody(`http://127.0.0.1:${port}${SUBTITLE_PATH}`)
    expect(segments).toEqual([{ from: 0.2, to: 3, content: '白名单内字幕' }])
    const subtitleRequest = recorded.find((r) => r.url === SUBTITLE_PATH)
    expect(subtitleRequest?.cookie).toBe('SESSDATA=happy')
  })

  it('协议相对的 //host 归一成 https 后同样过白名单', async () => {
    const client = localClient()
    await expect(client.fetchSubtitleBody('//evil.example.com/x.json')).rejects.toMatchObject({ kind: 'blocked_host' })
  })
})

describe('fetchImageAsDataUrl: 封面 pic 的主机也过白名单', () => {
  it('白名单内的封面照常转 data URL（happy path 回归）', async () => {
    const client = localClient()
    const dataUrl = await client.fetchImageAsDataUrl(`http://127.0.0.1:${port}${COVER_PATH}`)
    expect(dataUrl).toContain('data:image/png;base64,')
  })

  it('外部主机的封面返回 null 且不发请求（与既有 best-effort 语义一致）', async () => {
    const client = localClient()
    expect(await client.fetchImageAsDataUrl('https://pic.evil.example.com/x.png')).toBeNull()
    expect(recorded).toHaveLength(0)
  })
})

describe('resolveShortLink: 只认 b23.tv 自己的短码', () => {
  function recordingClient(): { client: BilibiliClient; urls: string[] } {
    const urls: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url)
      return {
        ok: true,
        status: 302,
        headers: { get: (name: string) => (name === 'location' ? 'https://www.bilibili.com/video/BV1ALLOW0001' : null) },
        url: 'WRONG-ON-PURPOSE',
        json: async () => ({}),
        text: async () => '{}',
        arrayBuffer: async () => new ArrayBuffer(0)
      }
    }
    return { client: new BilibiliClient(async () => 'SESSDATA=abc', fetchImpl), urls }
  }

  it('b23.tv 短链原样解析出 Location（happy path 回归）', async () => {
    const { client, urls } = recordingClient()
    expect(await client.resolveShortLink('https://b23.tv/abc123')).toBe('https://www.bilibili.com/video/BV1ALLOW0001')
    expect(urls).toEqual(['https://b23.tv/abc123'])
  })

  it('http / 缺 scheme 的输入都规范化成 https://b23.tv/<code> 再请求', async () => {
    const http = recordingClient()
    expect(await http.client.resolveShortLink('http://b23.tv/abc123')).toBe('https://www.bilibili.com/video/BV1ALLOW0001')
    expect(http.urls).toEqual(['https://b23.tv/abc123'])
    const bare = recordingClient()
    await bare.client.resolveShortLink('b23.tv/abc123')
    expect(bare.urls).toEqual(['https://b23.tv/abc123'])
  })

  it('没有 Location 时返回规范化的短链本身，不迷信 res.url', async () => {
    const urls: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url)
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        url: 'https://elsewhere.example.com/final',
        json: async () => ({}),
        text: async () => '{}',
        arrayBuffer: async () => new ArrayBuffer(0)
      }
    }
    const client = new BilibiliClient(async () => 'SESSDATA=abc', fetchImpl)
    expect(await client.resolveShortLink('https://b23.tv/abc123')).toBe('https://b23.tv/abc123')
  })

  it('非 b23.tv 主机一律拒绝，且一个字节都不发出去', async () => {
    for (const hostile of ['https://b23.tv.evil.com/abc', 'https://evil.com/b23.tv/abc', 'https://evil.com/x?u=b23.tv/abc', 'https://b23.tv.evil.com/abc']) {
      const { client, urls } = recordingClient()
      await expect(client.resolveShortLink(hostile)).rejects.toMatchObject({ kind: 'blocked_host' })
      expect(urls, hostile).toEqual([])
    }
  })
})
