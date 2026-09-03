/**
 * Main-window embedded login (v0.2.1 V2).
 *
 * The second renderer never loads on this machine (see PROGRESS), so the
 * login window is retired: the MAIN window itself navigates to the
 * resourcemanage-ui SPA (see UI_LOGIN_PATH for why the portal root is the
 * wrong entry), the user signs in through its OAuth round-trip, and the
 * login completes when the session probe — the course-list API answered
 * with the platform business envelope — succeeds. That is the single
 * authoritative signal: the probe endpoint IS what listCourses calls, so
 * harvest time is guaranteed to produce a working session (field case
 * 2026-09-03: harvesting on the SSO return navigation alone produced a 401
 * session, because the OAuth2 callback chain was still settling and the
 * portal-root landing never wrote the SPA JWT). The away-and-back
 * navigation and a freshly appearing sessionStorage JWT only POKE an
 * immediate probe. Cookie and JWT values are then harvested with the app's
 * own abilities, handed to onSession (which persists them encrypted), and
 * the app UI is restored — also on failure. Cookie and JWT values are
 * never logged.
 */
import { isCasLoginRedirect, mergeCookieStrings } from '../school/api-parse'
import { PLATFORM_API_BASE_PATH, SESSION_PROBE_PATH, probeSaysLoggedIn } from './cas-login'

/** Wall-clock budget for reaching the platform page (user typing time is not limited). */
export const LOGIN_LOAD_TIMEOUT_MS = 25_000
/** How often the tab is polled for the JWT / probe while the user signs in. */
export const LOGIN_POLL_INTERVAL_MS = 3_000
/** The SPA's sessionStorage key for its JWT (appName = first path segment). */
export const JWT_STORAGE_KEY = 'jy-application-resourcemanage-ui_STORAGE_KEY_JWT_TOKEN'
/** The landing SPA writes its JWT shortly after the redirect completes. */
const HARVEST_GRACE_MS = 1_500
/** Probe budget per poll tick. */
const PROBE_TIMEOUT_MS = 6_000
/**
 * Login entry = the resourcemanage-ui SPA itself, NOT the portal root: the
 * portal never writes the SPA's JWT (field 2026-09-03), while this SPA runs
 * the RBAC/OAuth round-trip on its own — it bounces an unauthenticated user
 * to the sign-in page and writes the JWT to sessionStorage on return, which
 * is exactly what the probe (and every later API call) needs.
 */
export const UI_LOGIN_PATH = '/jy-application-resourcemanage-ui/'

export const READ_JWT_SCRIPT = `(function () {
  return sessionStorage.getItem(${JSON.stringify(JWT_STORAGE_KEY)}) || '';
})()`

export interface HarvestedLoginSession {
  cookieString: string
  jwt: string
}

export interface MainWindowLoginOptions {
  /** e.g. https://cvs.seu.edu.cn */
  serviceOrigin: string
  /** Restore the app UI after login completes or fails (V1 harvest pattern). */
  restoreApp: () => Promise<void>
  /** Receives the harvested session when login completes (persists it). */
  onSession: (session: HarvestedLoginSession) => void
  logger?: { info(message: string): void; error(message: string): void }
  loadTimeoutMs?: number
  pollIntervalMs?: number
}

/** Structural view of the main window (tests substitute stubs). */
export interface LoginWindowLike {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    getURL(): string
    loadURL(url: string): Promise<void>
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
    session: {
      cookies: {
        get(filter: { url: string }): Promise<Array<{ name: string; value: string }>>
      }
    }
    on(event: 'did-navigate', listener: (event: unknown, url: string) => void): unknown
    on(event: 'did-fail-load', listener: (event: unknown, code: number, desc: string) => void): unknown
    removeListener(event: 'did-navigate', listener: (event: unknown, url: string) => void): unknown
    removeListener(event: 'did-fail-load', listener: (event: unknown, code: number, desc: string) => void): unknown
  }
}

export interface LoginNavState {
  /** The tab has navigated away from the platform origin (SSO round-trip). */
  leftOrigin: boolean
  /** The SSO redirected back onto the origin — time to probe (not final). */
  backOnOrigin: boolean
}

/**
 * did-navigate signal: the SSO redirects off the origin and back. The return
 * is NOT the finish line — the OAuth2 callback chain may still be settling
 * the server-side session (field case 2026-09-03: harvesting on the first
 * return produced a 401 session). The back transition only pokes the probe,
 * which stays the single authoritative completion signal (the probe endpoint
 * IS the course-list endpoint, so probe success ⇒ listCourses works).
 */
export function advanceLoginNav(leftOrigin: boolean, url: string, origin: string): LoginNavState {
  if (!url.startsWith(origin)) return { leftOrigin: true, backOnOrigin: false }
  if (leftOrigin && isCasLoginRedirect(url)) return { leftOrigin: true, backOnOrigin: false }
  return { leftOrigin, backOnOrigin: leftOrigin }
}

/** V2.4: SEU_LOGIN_WINDOW=1 keeps the legacy login-window path available. */
export function loginWindowFallbackRequested(
  env: { SEU_LOGIN_WINDOW?: string | undefined } = process.env
): boolean {
  return env.SEU_LOGIN_WINDOW === '1'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readTabJwt(win: LoginWindowLike): Promise<string> {
  try {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return ''
    const raw = await win.webContents.executeJavaScript(READ_JWT_SCRIPT, true)
    return typeof raw === 'string' ? raw : ''
  } catch {
    return ''
  }
}

/** Harvest the session from the tab that just completed the login. */
async function harvestTabSession(win: LoginWindowLike, serviceOrigin: string): Promise<HarvestedLoginSession> {
  const cookies = await win.webContents.session.cookies.get({ url: serviceOrigin })
  const cookieString = mergeCookieStrings('', cookies.map((c) => `${c.name}=${c.value}`).join('; '))
  return { cookieString, jwt: await readTabJwt(win) }
}

/**
 * Fallback completion signal: the platform API answers the probe with its
 * business envelope — covers a silent SSO pass-through where the SPA never
 * leaves the origin.
 */
async function probeTabSession(win: LoginWindowLike, serviceOrigin: string, jwt: string): Promise<boolean> {
  try {
    const cookies = await win.webContents.session.cookies.get({ url: serviceOrigin })
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const headers: Record<string, string> = {}
    if (cookieHeader !== '') headers.Cookie = cookieHeader
    if (jwt !== '') headers['jwt-token'] = jwt
    const res = await fetch(`${serviceOrigin}${PLATFORM_API_BASE_PATH}${SESSION_PROBE_PATH}`, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    return probeSaysLoggedIn(res.status, await res.text())
  } catch {
    return false
  }
}

/**
 * did-navigate/did-fail-load wiring: first arrival on the origin raises
 * onArrival (first-paint budget cleared, polling starts); the SSO
 * away-and-back transition raises onBackOnOrigin (probe poked — not final);
 * a hard load failure raises onFail (ERR_ABORTED is a navigation
 * interrupted by another one — not a failure).
 */
function attachNavListeners(
  win: LoginWindowLike,
  origin: string,
  handlers: { onArrival: () => void; onBackOnOrigin: () => void; onFail: (message: string) => void }
): () => void {
  let arrived = false
  let leftOrigin = false
  const onNav = (_event: unknown, url: string): void => {
    if (!arrived && url.startsWith(origin)) {
      arrived = true
      handlers.onArrival()
    }
    const next = advanceLoginNav(leftOrigin, url, origin)
    leftOrigin = next.leftOrigin
    if (next.backOnOrigin) handlers.onBackOnOrigin()
  }
  const onLoadFail = (_event: unknown, code: number, desc: string): void => {
    if (code === -3) return
    handlers.onFail(`平台页加载失败（${desc || `错误码 ${code}`}）`)
  }
  win.webContents.on('did-navigate', onNav)
  win.webContents.on('did-fail-load', onLoadFail)
  return () => {
    win.webContents.removeListener('did-navigate', onNav)
    win.webContents.removeListener('did-fail-load', onLoadFail)
  }
}

/**
 * Session polling: the probe (platform business envelope on the course-list
 * endpoint) is the single authoritative completion signal; the sessionStorage
 * JWT only feeds the probe's jwt-token header. `poke` runs an immediate tick
 * for navigation signals (SSO back, JWT appearing) without waiting for the
 * next interval.
 */
function startSessionPolling(
  win: LoginWindowLike,
  opts: MainWindowLoginOptions,
  isSettled: () => boolean,
  onComplete: () => void
): { stop: () => void; poke: () => void } {
  let probing = false
  const tick = async (): Promise<void> => {
    if (isSettled() || probing) return
    probing = true
    try {
      const jwt = await readTabJwt(win)
      if (!isSettled() && (await probeTabSession(win, opts.serviceOrigin, jwt))) onComplete()
    } finally {
      probing = false
    }
  }
  const timer = setInterval(() => void tick(), opts.pollIntervalMs ?? LOGIN_POLL_INTERVAL_MS)
  return {
    stop: () => clearInterval(timer),
    poke: () => void tick()
  }
}

/**
 * Navigation + polling flow. The first-paint budget covers reaching the
 * platform page only; after that the user's typing time is not limited
 * (same semantics as the legacy cas-login window).
 */
async function runLoginFlow(win: LoginWindowLike, opts: MainWindowLoginOptions): Promise<void> {
  const loadTimeoutMs = opts.loadTimeoutMs ?? LOGIN_LOAD_TIMEOUT_MS
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let loadTimer: NodeJS.Timeout | undefined
    let stopPolling: () => void = () => undefined
    let pokePolling: () => void = () => undefined

    const teardown = (): void => {
      removeNavListeners()
      stopPolling()
      if (loadTimer != null) clearTimeout(loadTimer)
    }
    const fail = (message: string): void => {
      if (settled) return
      settled = true
      teardown()
      opts.logger?.error(`main-window login failed: ${message.slice(0, 200)}`)
      reject(new Error(message))
    }
    const complete = (): void => {
      if (settled) return
      settled = true
      teardown()
      void (async () => {
        try {
          await sleep(HARVEST_GRACE_MS)
          opts.onSession(await harvestTabSession(win, opts.serviceOrigin))
          resolve()
        } catch (err) {
          opts.logger?.error(`main-window login harvest failed: ${(err as Error).message}`)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })()
    }

    const removeNavListeners = attachNavListeners(win, opts.serviceOrigin, {
      onArrival: () => {
        if (loadTimer != null) {
          clearTimeout(loadTimer)
          loadTimer = undefined
        }
        const polling = startSessionPolling(win, opts, () => settled, complete)
        stopPolling = polling.stop
        pokePolling = polling.poke
      },
      onBackOnOrigin: () => pokePolling(),
      onFail: fail
    })

    loadTimer = setTimeout(() => fail(`平台页加载超时（${Math.round(loadTimeoutMs / 1000)} 秒）`), loadTimeoutMs)
    win.webContents.loadURL(opts.serviceOrigin + UI_LOGIN_PATH).catch((err: Error) => {
      if (err.message.includes('ERR_ABORTED')) return
      fail(`平台页导航失败: ${err.message}`)
    })
  })
}

/**
 * Log in inside the main window: navigate to the platform, wait for the
 * completion signal, harvest the session, and always restore the app UI.
 */
export async function loginViaMainWindow(win: LoginWindowLike, opts: MainWindowLoginOptions): Promise<void> {
  if (win.isDestroyed()) throw new Error('主窗口不可用，无法开始登录')
  try {
    await runLoginFlow(win, opts)
    opts.logger?.info('main-window login: session harvested (values never logged)')
  } finally {
    try {
      await opts.restoreApp()
    } catch (err) {
      opts.logger?.error(`登录后恢复应用界面失败: ${(err as Error).message}`)
    }
  }
}
