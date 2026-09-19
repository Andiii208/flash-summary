import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { rmSync } from 'fs'
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
  }

  const windows: FakeWindow[] = []
  const sessions: FakeSession[] = []
  const traceDir = `${process.env.TEMP || process.env.TMP || '.'}/seu-cas-login-window-test`

  class FakeWindow {
    readonly webContents = new FakeWebContents()
    readonly closedListeners: Array<() => void> = []
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
})
