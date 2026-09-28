import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  JWT_STORAGE_KEY,
  LOGIN_LOAD_TIMEOUT_MS,
  advanceLoginNav,
  loginViaMainWindow,
  loginWindowFallbackRequested,
  type HarvestedLoginSession,
  type LoginWindowLike
} from '../src/main/auth/main-window-login'

const ORIGIN = 'https://cvs.seu.edu.cn'
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface StubOptions {
  jwt?: string
  cookies?: Array<{ name: string; value: string }>
  loadUrlError?: Error
  hangLoad?: boolean
}

/** A window stub whose navigations are driven manually by the test. */
function stubWindow(stub: StubOptions = {}): LoginWindowLike & {
  nav(url: string): void
  failLoad(code: number, desc: string): void
  loadedUrls: string[]
} {
  type NavListener = (event: unknown, url: string) => void
  type FailListener = (event: unknown, code: number, desc: string) => void
  type AnyListener = NavListener | FailListener
  const navListeners: AnyListener[] = []
  const failListeners: AnyListener[] = []
  const loadedUrls: string[] = []
  return {
    isDestroyed: () => false,
    nav: (url) => navListeners.forEach((l) => (l as NavListener)(null, url)),
    failLoad: (code, desc) => failListeners.forEach((l) => (l as FailListener)(null, code, desc)),
    loadedUrls,
    webContents: {
      isDestroyed: () => false,
      getURL: () => ORIGIN,
      loadURL: (url: string) => {
        loadedUrls.push(url)
        if (stub.hangLoad === true) return new Promise<void>(() => undefined)
        if (stub.loadUrlError != null) return Promise.reject(stub.loadUrlError)
        navListeners.forEach((l) => (l as NavListener)(null, url))
        return Promise.resolve()
      },
      executeJavaScript: () => Promise.resolve(stub.jwt ?? ''),
      session: {
        cookies: {
          get: () => Promise.resolve(stub.cookies ?? [])
        }
      },
      on: (event: 'did-navigate' | 'did-fail-load', listener: AnyListener) => {
        if (event === 'did-navigate') navListeners.push(listener)
        else failListeners.push(listener)
        return undefined
      },
      removeListener: (event: 'did-navigate' | 'did-fail-load', listener: AnyListener) => {
        const list = event === 'did-navigate' ? navListeners : failListeners
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
        return undefined
      }
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SEU_LOGIN_WINDOW
})

describe('advanceLoginNav — did-navigate signal', () => {
  it('marks the SSO away-and-back as back-on-origin (probe poked, not final)', () => {
    let state = advanceLoginNav(false, `${ORIGIN}/`, ORIGIN)
    expect(state).toEqual({ leftOrigin: false, backOnOrigin: false })
    state = advanceLoginNav(state.leftOrigin, 'https://auth.seu.edu.cn/oauth/login', ORIGIN)
    expect(state).toEqual({ leftOrigin: true, backOnOrigin: false })
    state = advanceLoginNav(state.leftOrigin, `${ORIGIN}/jy-application-resourcemanage-ui/`, ORIGIN)
    expect(state).toEqual({ leftOrigin: true, backOnOrigin: true })
  })

  it('keeps waiting while the return still carries login-page markers', () => {
    // H30 (audit 2026-09-28): 收紧前 `isCasLoginRedirect` 扫全串，查询里带
    // authserver/login 字样也算「登录页标记」——那是误报源（SSO 回跳的
    // redirect 参数再正常不过）。现在查询串不算，只有**嵌完整登录 URL**或
    // 路径段命中才算。这里钉住收紧后的行为：回 origin 且不带登录页标记 → poke
    // 探活；探活才是唯一权威完成信号（probeTabSession），poke 一下不会误判
    // 登录成功。
    expect(advanceLoginNav(true, `${ORIGIN}/?redirect=authserver`, ORIGIN).backOnOrigin).toBe(true)
    // 嵌了完整的登录 URL（ids.seu.edu.cn/authserver/…）仍然算登录页。
    expect(advanceLoginNav(true, `${ORIGIN}/?redirect=https://ids.seu.edu.cn/authserver/login`, ORIGIN).backOnOrigin).toBe(false)
    // 路径段命中的登录页同样算。
    expect(advanceLoginNav(true, `${ORIGIN}/cas/login`, ORIGIN).backOnOrigin).toBe(false)
  })

  it('in-window platform navigation alone never pokes', () => {
    expect(advanceLoginNav(false, `${ORIGIN}/#/play-video`, ORIGIN).backOnOrigin).toBe(false)
  })
})

describe('loginWindowFallbackRequested — V2.4 switch', () => {
  it('routes to the legacy window only when SEU_LOGIN_WINDOW=1', () => {
    expect(loginWindowFallbackRequested({})).toBe(false)
    expect(loginWindowFallbackRequested({ SEU_LOGIN_WINDOW: '1' })).toBe(true)
  })

  it('keeps the first-paint budget tight (dead network fails fast)', () => {
    expect(LOGIN_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })
})

describe('loginViaMainWindow — the probe is the authoritative completion signal', () => {
  /** A platform envelope answer for the probe (200 {code:...}). */
  function stubProbeFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: '0', data: { records: [] } }), { status: 200 }))
    )
  }

  it('completes after the SSO away-and-back poke confirms via probe, harvests, restores', async () => {
    stubProbeFetch()
    const win = stubWindow({ jwt: 'jwt-abc', cookies: [{ name: 'plat', value: 'v1' }] })
    const restored = vi.fn()
    const harvested: HarvestedLoginSession[] = []
    const flow = loginViaMainWindow(win, {
      serviceOrigin: ORIGIN,
      restoreApp: restored,
      onSession: (session) => harvested.push(session),
      pollIntervalMs: 10_000
    })
    win.nav(`${ORIGIN}/`)
    win.nav('https://auth.seu.edu.cn/oauth/authorize')
    win.nav(`${ORIGIN}/jy-application-resourcemanage-ui/`)
    await flow
    expect(harvested).toHaveLength(1)
    expect(harvested[0]?.cookieString).toContain('plat=v1')
    expect(harvested[0]?.jwt).toBe('jwt-abc')
    expect(restored).toHaveBeenCalledTimes(1)
  }, 15_000)

  it('navigates to the resourcemanage-ui SPA — the portal root never writes the JWT', async () => {
    stubProbeFetch()
    const win = stubWindow({ jwt: 'jwt-entry', cookies: [] })
    const flow = loginViaMainWindow(win, {
      serviceOrigin: ORIGIN,
      restoreApp: vi.fn(),
      onSession: () => undefined,
      pollIntervalMs: 10_000
    })
    win.nav(`${ORIGIN}/jy-application-resourcemanage-ui/`)
    await flow
    expect(win.loadedUrls).toEqual([`${ORIGIN}/jy-application-resourcemanage-ui/`])
  }, 15_000)

  it('does NOT complete on navigation alone when the probe still fails (401 case)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 }))
    )
    const win = stubWindow({ jwt: '', cookies: [] })
    const harvested: HarvestedLoginSession[] = []
    const flow = loginViaMainWindow(win, {
      serviceOrigin: ORIGIN,
      restoreApp: vi.fn(),
      onSession: (session) => harvested.push(session),
      pollIntervalMs: 40
    })
    win.nav(`${ORIGIN}/`)
    win.nav('https://auth.seu.edu.cn/oauth/login')
    win.nav(`${ORIGIN}/`)
    await sleep(300) // several poll ticks + the poked probe all fail
    expect(harvested).toHaveLength(0)
    // The flow keeps waiting (user typing time is not limited).
    void flow.catch(() => undefined)
    await expect(Promise.race([flow, sleep(50).then(() => 'still-waiting')])).resolves.toBe('still-waiting')
  }, 15_000)

  it('completes on the poll when the probe answers the envelope (silent SSO path)', async () => {
    stubProbeFetch()
    const win = stubWindow({ jwt: 'jwt-xyz', cookies: [] })
    const harvested: HarvestedLoginSession[] = []
    await loginViaMainWindow(win, {
      serviceOrigin: ORIGIN,
      restoreApp: vi.fn(),
      onSession: (session) => harvested.push(session),
      pollIntervalMs: 20
    })
    win.nav(`${ORIGIN}/`)
    expect(harvested).toHaveLength(1)
    expect(harvested[0]?.jwt).toBe('jwt-xyz')
  }, 15_000)
})

describe('loginViaMainWindow — failure paths always restore the UI', () => {
  it('rejects on a hard load failure and still restores', async () => {
    const win = stubWindow()
    const restored = vi.fn()
    const flow = loginViaMainWindow(win, {
      serviceOrigin: ORIGIN,
      restoreApp: restored,
      onSession: () => undefined
    })
    win.failLoad(502, 'ERR_BAD_GATEWAY')
    await expect(flow).rejects.toThrow('ERR_BAD_GATEWAY')
    expect(restored).toHaveBeenCalledTimes(1)
  })

  it('rejects on the first-paint budget when the navigation never commits', async () => {
    const win = stubWindow({ hangLoad: true })
    const restored = vi.fn()
    await expect(
      loginViaMainWindow(win, {
        serviceOrigin: ORIGIN,
        restoreApp: restored,
        onSession: () => undefined,
        loadTimeoutMs: 50
      })
    ).rejects.toThrow('超时')
    expect(restored).toHaveBeenCalledTimes(1)
  })

  it('treats an interrupted navigation (ERR_ABORTED) as not-a-failure', async () => {
    const win = stubWindow({ loadUrlError: new Error('Error: ERR_ABORTED (-3) loading') })
    const restored = vi.fn()
    // The abort is swallowed, so the first-paint budget is what rejects —
    // proving the abort itself never surfaced as a load failure.
    await expect(
      loginViaMainWindow(win, {
        serviceOrigin: ORIGIN,
        restoreApp: restored,
        onSession: () => undefined,
        loadTimeoutMs: 80
      })
    ).rejects.toThrow('超时')
    expect(restored).toHaveBeenCalledTimes(1)
  })

  it('refuses a destroyed window without restoring', async () => {
    const win = stubWindow()
    Object.defineProperty(win, 'isDestroyed', { value: () => true })
    const restored = vi.fn()
    await expect(
      loginViaMainWindow(win, { serviceOrigin: ORIGIN, restoreApp: restored, onSession: () => undefined })
    ).rejects.toThrow('主窗口不可用')
    expect(restored).not.toHaveBeenCalled()
  })
})

describe('JWT harvesting script', () => {
  it('reads exactly the platform SPA storage key', () => {
    expect(JWT_STORAGE_KEY).toBe('jy-application-resourcemanage-ui_STORAGE_KEY_JWT_TOKEN')
  })
})
