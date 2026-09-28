import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { sessionAwareFetch } from '../src/main/net-fetch'

/**
 * H2 (audit 2026-09-28): 会话感知 fetch 的回退/透传/两条边界。
 *
 * 1. electron mock 没有 net.fetch → 回退 globalThis.fetch（测试环境常态，
 *    回退路径绝不能炸）。
 * 2. mock 出 net.fetch → 必须被调用且 url/init 原样透传（Chromium 网络栈只有
 *    拿到调用方的 method/headers 才有意义）。
 * 3. `redirect: 'manual'` 一律回退——net.fetch 对它抛 «Redirect was cancelled»
 *    （electron#43715），而短链/QR 确认/CAS 跳转识别都要读到 3xx 本身。
 * 4. AbortSignal 必须被兑现成 reject——net.fetch 不保证兑现它，而调用方拿它当
 *    唯一硬超时（登录 precheck / 会话探活），被忽略就是永久挂起。
 */

/** electron mock 的缝：用 getter 让测试在 import 之后仍能替换 net.fetch。 */
const electronStub = vi.hoisted(() => ({ netFetch: undefined as unknown }))

vi.mock('electron', () => ({
  net: {
    get fetch() {
      return electronStub.netFetch
    }
  }
}))

function mockNetFetch(impl: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(impl)
  electronStub.netFetch = fetchMock
  return fetchMock
}

beforeEach(() => {
  electronStub.netFetch = undefined
})

afterEach(() => {
  electronStub.netFetch = undefined
  vi.unstubAllGlobals()
})

describe('sessionAwareFetch — net.fetch 可用时走 Chromium 网络栈', () => {
  it('调用 net.fetch 并把 url/init 原样透传', async () => {
    const fetchMock = mockNetFetch(async () => new Response('from-net'))
    const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    const res = await sessionAwareFetch('https://api.example.com/v1/x', init)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/x', init)
    expect(await res.text()).toBe('from-net')
  })

  it('net.fetch 的 Response.url 空串被钉回请求 url（Electron 文档明示 url 不正确）', async () => {
    mockNetFetch(async () => new Response('ok'))
    const res = await sessionAwareFetch('https://api.example.com/v1/x')
    expect(new Response('ok').url).toBe('')
    expect(res.url).toBe('https://api.example.com/v1/x')
  })

  it('manual redirect 回退 globalThis.fetch，net.fetch 一次都不碰', async () => {
    const fetchMock = mockNetFetch(async () => new Response('must-not-be-used'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://www.bilibili.com/video/BV1xx' } }))
    )
    const res = await sessionAwareFetch('https://b23.tv/abc', { redirect: 'manual' })
    expect(res.status).toBe(302)
    // 3xx 本体读得到——短链解析/QR 确认/CAS 识别的命门。
    expect(res.headers.get('location')).toBe('https://www.bilibili.com/video/BV1xx')
    expect(res.url).toBe('https://b23.tv/abc')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('sessionAwareFetch — 没有 net.fetch 时回退', () => {
  it('electron mock 无 net.fetch → 走 globalThis.fetch（行为与改造前一致）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('from-global')))
    const res = await sessionAwareFetch('https://cvs.seu.edu.cn/probe')
    expect(await res.text()).toBe('from-global')
    expect(res.url).toBe('https://cvs.seu.edu.cn/probe')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('sessionAwareFetch — AbortSignal 必须被兑现', () => {
  it('已 abort 的信号不再发请求，直接 reject', async () => {
    const fetchMock = mockNetFetch(async () => new Response('ok'))
    const controller = new AbortController()
    controller.abort()
    await expect(sessionAwareFetch('https://api.example.com/x', { signal: controller.signal })).rejects.toThrowError()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('请求途中 abort → reject，且底层迟到的 rejection 不会逃逸成 unhandledRejection', async () => {
    // 底层 net.fetch 在 abort 之后又抛一次（它的真实形态）——race 必须接住，
    // 否则进程级 unhandledRejection 会惊动 process-guards。
    const dangling: { fail: (() => void) | null } = { fail: null }
    mockNetFetch(
      () =>
        new Promise<Response>((_resolve, reject) => {
          dangling.fail = (): void => reject(new Error('Redirect was cancelled'))
        })
    )
    const controller = new AbortController()
    const guarded = sessionAwareFetch('https://api.example.com/x', { signal: controller.signal }).catch((e: unknown) => e)
    controller.abort()
    const err = await guarded
    expect((err as Error).message).toMatch(/abort/i)
    dangling.fail?.()
    // 给节点一个宏任务机会把迟到 rejection 判成 unhandled（vitest 会因此失败）。
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(true).toBe(true)
  })
})
