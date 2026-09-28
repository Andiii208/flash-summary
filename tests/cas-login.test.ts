import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  casLoadErrorMessage,
  CAS_LOAD_TIMEOUT_MS,
  CAS_PRECHECK_TIMEOUT_MS,
  describeJsonShape,
  describeUrl,
  openCasLoginWindow,
  PLATFORM_API_BASE_PATH,
  probeSaysLoggedIn,
  SESSION_PROBE_PATH
} from '../src/main/auth/cas-login'
import { CAS_BASE_URL, createContext } from '../src/main/app-context'
import type { Cryptor } from '../src/main/auth/session-crypto'

/**
 * 批1修复轮 C1：openCasLoginWindow 的 closed 处理器回归测试。
 *
 * 修复前 untraceSession 调用运行时并不存在的
 * ses.webRequest.onBeforeRequest.removeListener —— closed 处理器在那里抛
 * TypeError，其后的 reject 分支被跳过，登录完成前关窗时 promise 永不 settling。
 * 这里用 fake session/webContents 驱动真实 openCasLoginWindow，钉住：
 * 关窗 → reject + trace 监听已摘除 + closed 处理器不再抛。
 */
const casFakes = vi.hoisted(() => {
  class FakeWebContents {
    readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    windowOpenHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | null = null
    on(event: string, listener: (...args: unknown[]) => void): void {
      const list = this.listeners.get(event) ?? []
      list.push(listener)
      this.listeners.set(event, list)
    }
    once(event: string, listener: (...args: unknown[]) => void): void {
      this.on(event, listener)
    }
    setWindowOpenHandler(fn: (details: { url: string }) => { action: 'allow' | 'deny' }): void {
      this.windowOpenHandler = fn
    }
    isLoading(): boolean {
      return false
    }
    executeJavaScript(): Promise<string> {
      return Promise.resolve(JSON.stringify({ jwt: '' }))
    }
    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
    }
  }

  /** webRequest.onBeforeRequest 调用流水：listener=函数为挂上，null 为退订。 */
  class FakeSession {
    readonly traceCalls: Array<{ listener: unknown }> = []
    readonly cookies = { get: async () => [] }
    readonly webRequest = {
      onBeforeRequest: (listener: unknown): void => {
        this.traceCalls.push({ listener })
      }
    }
    /** 探活响应：默认 401（未登录）；测试改写它以驱动「轮询确认登录」路径。 */
    probeResponse: { status: number; body: string } = { status: 401, body: '{}' }
    readonly fetch = async (): Promise<{ status: number; text: () => Promise<string> }> => ({
      status: this.probeResponse.status,
      text: async () => this.probeResponse.body
    })
  }

  const windows: FakeWindow[] = []
  const sessions: FakeSession[] = []
  const traceDir = `${process.env.TEMP || process.env.TMP || '.'}/seu-cas-login-window-test`

  class FakeWindow {
    readonly webContents = new FakeWebContents()
    readonly closedListeners: Array<() => void> = []
    /** emitClosed 调用次数：收尾关窗（close/destroy）的取证。 */
    closedEmitted = 0
    destroyed = false
    constructor(_options: unknown) {
      windows.push(this)
    }
    on(event: string, listener: () => void): void {
      if (event === 'closed') this.closedListeners.push(listener)
    }
    once(): void {}
    isDestroyed(): boolean {
      return this.destroyed
    }
    show(): void {}
    loadFile(): Promise<void> {
      return Promise.resolve()
    }
    close(): void {
      this.emitClosed()
    }
    destroy(): void {
      this.destroyed = true
      this.emitClosed()
    }
    emitClosed(): void {
      this.closedEmitted += 1
      for (const listener of this.closedListeners) listener()
    }
  }

  return { windows, sessions, traceDir, FakeSession, FakeWindow }
})

vi.mock('electron', () => ({
  BrowserWindow: casFakes.FakeWindow,
  session: {
    fromPartition: () => {
      const ses = new casFakes.FakeSession()
      casFakes.sessions.push(ses)
      return ses
    },
    defaultSession: new casFakes.FakeSession()
  },
  app: { getPath: () => casFakes.traceDir }
}))

describe('describeUrl (net-trace keeps query keys, never values)', () => {
  it('reduces a signed playback URL to origin+path+key names', () => {
    const out = describeUrl('https://cvs.seu.edu.cn/vod/play?auth_key=secret123-expire&jwt=abc')
    expect(out).toBe('https://cvs.seu.edu.cn/vod/play?auth_key&jwt')
    expect(out).not.toContain('secret123')
    expect(out).not.toContain('abc')
  })

  it('falls back to a placeholder for unparsable input', () => {
    expect(describeUrl('not a url')).toBe('[URL]')
  })
})

describe('cas-load error messages (no credentials, no full URLs)', () => {
  it('precheck failure names the platform and the network hint', () => {
    const msg = casLoadErrorMessage('precheck', 'fetch failed')
    expect(msg).toContain('无法连接')
    expect(msg).toContain('录播平台')
    expect(msg).toContain('VPN')
  })

  it('timeout failure states the budget', () => {
    const msg = casLoadErrorMessage('timeout', '')
    expect(msg).toContain('超时')
    expect(msg).toContain('25')
    expect(msg).toContain('录播平台')
  })

  it('load failure carries the description without URLs', () => {
    const msg = casLoadErrorMessage('load', 'ERR_CONNECTION_RESET')
    expect(msg).toContain('ERR_CONNECTION_RESET')
    expect(msg).not.toMatch(/https?:\/\//)
  })

  it('keeps budgets tight so a dead network fails fast', () => {
    expect(CAS_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
    expect(CAS_PRECHECK_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
  })
})

describe('session probe targets the calibrated API (field 2026-09-01)', () => {
  it('polls the real course list endpoint, not a retired guess', () => {
    expect(SESSION_PROBE_PATH).toContain('/v1/group_subject_vod_list/t-1')
    expect(SESSION_PROBE_PATH).toContain('page.pageIndex=1')
  })

  it('API base has no -ui suffix (that is the static assets prefix)', () => {
    expect(PLATFORM_API_BASE_PATH).toBe('/jy-application-resourcemanage')
  })
})

describe('probeSaysLoggedIn requires the platform business envelope', () => {
  it('accepts the platform envelope shapes (code/result/data)', () => {
    expect(probeSaysLoggedIn(200, '{"code":"0","result":{"records":[]}}')).toBe(true)
    expect(probeSaysLoggedIn(200, '{"data":{"id":"l1"}}')).toBe(true)
    expect(probeSaysLoggedIn(200, '[{"courId":"c1"}]')).toBe(true)
  })

  it('rejects a bare 2xx JSON without any envelope key (interception layer)', () => {
    expect(probeSaysLoggedIn(200, '{"message":"blocked"}')).toBe(false)
    expect(probeSaysLoggedIn(200, '"ok"')).toBe(false)
  })

  it('rejects non-2xx, non-JSON, and login-page bodies', () => {
    expect(probeSaysLoggedIn(302, '{"code":"0"}')).toBe(false)
    expect(probeSaysLoggedIn(200, '<html>authserver login</html>')).toBe(false)
    expect(probeSaysLoggedIn(200, '{"code":"0"} trailing')).toBe(false)
  })
})

describe('describeJsonShape logs field names only (no values, no secrets)', () => {
  it('describes nested objects one level deep', () => {
    const shape = describeJsonShape('{"code":200,"result":{"total":3,"extra":1}}')
    expect(shape).toBe('json{code,result{total,extra}}')
  })

  it('describes arrays with element count and first-element keys', () => {
    const shape = describeJsonShape('{"result":{"records":[{"courId":1,"courName":"x"}]}}')
    expect(shape).toBe('json{result{records[1]{courId,courName}}}')
  })

  it('keeps scalars and empty arrays readable', () => {
    expect(describeJsonShape('{"code":0,"list":[],"flag":true}')).toBe('json{code,list[0],flag}')
  })

  it('falls back to a byte count for non-json bodies', () => {
    expect(describeJsonShape('<html>404</html>')).toBe('non-json(16b)')
    expect(describeJsonShape('')).toBe('non-json(0b)')
  })
})

describe('openCasLoginWindow — 批1修复 C1: 关窗必须 settle 且摘除 trace 监听', () => {
  const ORIGIN = 'https://cvs.seu.edu.cn'

  beforeEach(() => {
    casFakes.windows.length = 0
    casFakes.sessions.length = 0
    // precheck 的 HEAD 探活直接放行。
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(casFakes.traceDir, { recursive: true, force: true })
  })

  it('closing before login rejects the promise, unsubscribes the trace listener, and never throws', async () => {
    let rejection: unknown = null
    const promise = openCasLoginWindow({ serviceOrigin: ORIGIN, onSession: () => undefined }).catch((e) => {
      rejection = e
    })

    // 让 executor 跑完：loadFile 兑现、closed 处理器已注册。
    await new Promise((r) => setTimeout(r, 20))
    const win = casFakes.windows[0]
    expect(win).toBeDefined()

    // C1（修复前）：untraceSession 调用不存在的 removeListener → 这里同步抛
    // TypeError → closed 处理器后半段（reject）被跳过 → promise 永不 settling。
    let emitError: unknown = null
    try {
      win!.emitClosed()
    } catch (e) {
      emitError = e
    }
    expect(emitError).toBeNull()

    await new Promise((r) => setTimeout(r, 20))
    expect(rejection).toBeInstanceOf(Error)
    expect((rejection as Error).message).toContain('CAS login window closed before login completed')

    // trace 监听：挂上一次、退订一次（Electron 官方退订 = 把 listener 传 null）。
    const traceCalls = casFakes.sessions[0]!.traceCalls
    expect(traceCalls).toHaveLength(2)
    expect(typeof traceCalls[0]!.listener).toBe('function')
    expect(traceCalls[1]!.listener).toBeNull()
    await promise
  })

  /**
   * H6 (audit 2026-09-28): 假成功回归——「先持久化、后 resolve」。
   *
   * 旧写法 `void finish('ok')` 把 resolve 放 finally：onSession（→ saveSession →
   * DPAPI 落盘）抛错时，外层 promise 照样 resolve、异常逃逸成
   * unhandledRejection，调用方于是记 success 并写「login succeeded (session
   * encrypted at rest)」，磁盘上却什么都没有。
   *
   * 下面两条用例分别钉住：保存成功才 resolve（且 harvest 先于 resolve 完成）、
   * 保存失败必须 reject 并带原因。unhandled rejection 本身还会被 vitest 判失败，
   * 所以旧写法在这里是双重红灯。
   */
  describe('H6: 登录收尾必须「先持久化、后 resolve」', () => {
    const LANDING = `${ORIGIN}/jy-application-resourcemanage-ui/`
    const AWAY = 'https://auth.seu.edu.cn/oauth/authorize'

    /** 让 openCasLoginWindow 越过 loadFile/precheck 的微任务，拿到窗口句柄。 */
    async function flushOpen(): Promise<void> {
      await vi.advanceTimersByTimeAsync(20)
      expect(casFakes.windows.at(-1)).toBeDefined()
    }

    it('保存成功才 resolve——harvest 发生在 resolve 之前', async () => {
      vi.useFakeTimers()
      try {
        const harvested: Array<{ cookieString: string; jwt: string }> = []
        const promise = openCasLoginWindow({ serviceOrigin: ORIGIN, onSession: (s) => harvested.push(s) })
        await flushOpen()
        const win = casFakes.windows.at(-1)!
        // 离开源站再回落（SSO 往返）→ 导航收尾路径。
        win.webContents.emit('did-navigate', null, LANDING)
        win.webContents.emit('did-navigate', null, AWAY)
        win.webContents.emit('did-navigate', null, LANDING)
        // finish 里的 1500ms 收割宽限（等 SPA 把 JWT 写进 sessionStorage）。
        await vi.advanceTimersByTimeAsync(1600)
        await promise
        expect(harvested).toHaveLength(1)
        // fake cookies.get 返回 [] → merge 出来是空串；重点是 onSession 真的被
        // 调用了（= 持久化已发生），而不是 resolve 之后再补。
        expect(harvested[0]!.cookieString).toBe('')
        expect(win.destroyed).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })

    it('保存失败（saveSession/DPAPI 抛错）→ login 失败并带原因，绝不算成功', async () => {
      vi.useFakeTimers()
      try {
        const failures: unknown[] = []
        const promise = openCasLoginWindow({
          serviceOrigin: ORIGIN,
          onSession: () => {
            // saveSession → DPAPI 加密失败的替身：磁盘上什么都没落下。
            throw new Error('Encrypt failed')
          }
        }).catch((e: unknown) => {
          failures.push(e)
          return 'rejected' as const
        })
        await flushOpen()
        const win = casFakes.windows.at(-1)!
        win.webContents.emit('did-navigate', null, LANDING)
        win.webContents.emit('did-navigate', null, AWAY)
        win.webContents.emit('did-navigate', null, LANDING)
        await vi.advanceTimersByTimeAsync(1600)
        expect(await promise).toBe('rejected')
        expect(failures).toHaveLength(1)
        expect((failures[0] as Error).message).toContain('会话保存失败')
        expect((failures[0] as Error).message).toContain('Encrypt failed')
        // 假成功的另一半：窗口必须被收掉，不能留一个「登录完成了」的空窗。
        expect(win.closedEmitted).toBeGreaterThan(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('轮询探活路径同样先持久化后 resolve（两条触发路径行为统一）', async () => {
      vi.useFakeTimers()
      try {
        const harvested: Array<{ cookieString: string; jwt: string }> = []
        const promise = openCasLoginWindow({ serviceOrigin: ORIGIN, onSession: (s) => harvested.push(s) })
        await flushOpen()
        // 平台业务信封 = 登录完成（probeSaysLoggedIn 的唯一权威信号）。
        casFakes.sessions[0]!.probeResponse = { status: 200, body: '{"code":"0","result":{"records":[]}}' }
        const win = casFakes.windows.at(-1)!
        win.webContents.emit('did-navigate', null, LANDING)
        // 3s 轮询间隔 → 一个 tick 命中 → finish → 1500ms 宽限。
        await vi.advanceTimersByTimeAsync(3100)
        await vi.advanceTimersByTimeAsync(1600)
        await promise
        expect(harvested).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })

    /**
     * H6 的调用方视角（app-context.login）：持久化失败时整个登录必须失败，
     * 且**不能**写那条「login succeeded (session encrypted at rest)」——
     * 那句话是对磁盘状态的断言，写下来就是假证据。这里用真的 createContext
     * + 一个 encryptString 抛错的 cryptor（DPAPI 失败替身）驱动。
     */
    it('H6 调用方: saveSession 失败 → ctx.login() 拒绝，日志里没有「login succeeded」', async () => {
      vi.useFakeTimers()
      const dir = mkdtempSync(join(tmpdir(), 'seu-cas-login-ctx-'))
      process.env.SEU_LOGIN_WINDOW = '1'
      const failingCryptor: Cryptor = {
        isAvailable: () => true,
        encryptString: () => {
          throw new Error('DPAPI 加密失败')
        },
        decryptString: () => {
          throw new Error('不应被调用')
        }
      }
      const ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: failingCryptor })
      try {
        const login = ctx.login().catch((e: unknown) => e as Error)
        await vi.advanceTimersByTimeAsync(20)
        const win = casFakes.windows.at(-1)!
        win.webContents.emit('did-navigate', null, `${CAS_BASE_URL}/jy-application-resourcemanage-ui/`)
        win.webContents.emit('did-navigate', null, 'https://auth.seu.edu.cn/oauth/authorize')
        win.webContents.emit('did-navigate', null, `${CAS_BASE_URL}/jy-application-resourcemanage-ui/`)
        await vi.advanceTimersByTimeAsync(1600)
        const err = await login
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toContain('会话保存失败')

        const logsDir = join(dir, 'userdata', 'logs')
        const logs = readdirSync(logsDir)
          .map((f) => readFileSync(join(logsDir, f), 'utf8'))
          .join('\n')
        expect(logs).toContain('cas login failed')
        // 假成功的日志签名：持久化失败时它一次都不该出现。
        expect(logs).not.toContain('login succeeded (session encrypted at rest)')
      } finally {
        ctx.db.close()
        rmSync(dir, { recursive: true, force: true })
        delete process.env.SEU_LOGIN_WINDOW
        vi.useRealTimers()
      }
    }, 20_000)
  })
})
