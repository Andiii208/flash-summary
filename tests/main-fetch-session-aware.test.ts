import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createContext, type AppContext } from '../src/main/app-context'
import { sessionAwareFetch } from '../src/main/net-fetch'
import type { Cryptor } from '../src/main/auth/session-crypto'

/**
 * H2 (audit 2026-09-28) 验收钉：主进程默认 fetch 是会话感知的。
 *
 * 裸 globalThis.fetch 不读 Chromium 的 session 代理（index.ts 只给
 * defaultSession 设 system 代理）——Clash 混合端口（非 TUN）用户于是「窗口内
 * 网页正常、main 侧请求全挂」。这里 mock 出 electron 的 net.fetch（Chromium
 * 网络栈，复用同一份代理配置），钉两件事：
 *   ① school/bilibili client 的默认 fetchImpl 就是这个封装（app-context 的注入位）；
 *   ② provider HTTP（ASR/总结）真的命中 net.fetch。
 *
 * 注意（net-fetch.ts 边界 1）：school/bilibili 的 API 请求带
 * `redirect: 'manual'`，而 net.fetch 不支持 manual redirect（electron#43715，
 * 服务端 3xx 时抛 «Redirect was cancelled»）——那些请求留在 globalThis.fetch
 * 上，行为与改造前一致。本文件只对**不需要 manual 的路径**宣称代理可见。
 */

/** net.fetch 的调用记录与夹具响应体（全部 vi.hoisted：vi.mock 工厂被提升到
 *  import 之前执行，引用普通模块级 const 会 TDZ——mock 静默失效后请求会打到
 *  真网络，所以它们必须放在 hoisted 里）。 */
const netStub = vi.hoisted(() => ({
  urls: [] as string[],
  body: JSON.stringify({ choices: [{ message: { content: 'pong' } }] })
}))

vi.mock('electron', () => ({
  net: {
    fetch: (url: string): Promise<Response> => {
      netStub.urls.push(url)
      // 不打真网络：按夹具回一份合法的 chat completion。
      return Promise.resolve(new Response(netStub.body, { status: 200 }))
    }
  }
}))

const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

function makeCtx(): { ctx: AppContext; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'seu-summary-netfetch-'))
  const ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  return { ctx, dir }
}

describe('H2: createContext 的默认 fetch 是会话感知封装', () => {
  it('school/bilibili client 的默认 fetchImpl 就是 sessionAwareFetch（注入位没被改回裸 fetch）', () => {
    const { ctx, dir } = makeCtx()
    try {
      // fetchImpl 是私有字段——公开面拿不到它，而这条钉子防的正是「有人在
      // app-context 把默认值改回 globalThis.fetch」，所以必须摸到它。
      const school = ctx.school as unknown as { fetchImpl: unknown }
      const bilibili = ctx.bilibili as unknown as { fetchImpl: unknown }
      expect(school.fetchImpl).toBe(sessionAwareFetch)
      expect(bilibili.fetchImpl).toBe(sessionAwareFetch)
    } finally {
      ctx.db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('provider HTTP 走 net.fetch（Chromium 网络栈 → session 代理）', async () => {
    const { ctx, dir } = makeCtx()
    try {
      ctx.saveProvider({ name: 'Mock', baseUrl: 'https://provider.test/v1', apiKey: 'sk-test' })
      const providerId = ctx.providers().providers[0]!.id
      ctx.bind('multimodal', providerId, 'model-x')
      netStub.urls.length = 0

      const answer = await ctx.chatFor('multimodal').chat([{ role: 'user', content: 'hi' }], 'model-x')

      expect(answer).toBe('pong')
      const hit = netStub.urls.find((u) => u.startsWith('https://provider.test/v1/chat/completions'))
      expect(hit).toBeDefined()
    } finally {
      ctx.db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
