/**
 * In-app platform login window.
 *
 * Flow: reachability precheck (fail fast with a clear message) → a local
 * loading page shown immediately (no white screen) → the school platform's
 * own login page (cvs.seu.edu.cn) on a dedicated persistent session
 * partition. The platform renders its login form itself (verified in the
 * field: the browser opens cvs directly and prompts for credentials; the
 * ids.seu.edu.cn SSO host is unreachable from some campus segments), so we
 * let the user log in there and poll the school API with the window
 * session's cookies until the call succeeds — then harvest the cookies and
 * close. Cookie values are never logged.
 */
import { appendFileSync, mkdirSync, writeFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { BrowserWindow, session, app, type Session, type Event, type RenderProcessGoneDetails, type WebContentsDidStartNavigationEventParams } from 'electron'
import { mergeCookieStrings, isCasLoginRedirect } from '../school/api-parse'
import { directNetRequested } from '../net-diagnostics'
import { redact } from '../logger'

export interface CasLoginOptions {
  /** e.g. https://cvs.seu.edu.cn */
  serviceOrigin: string
  /** Login page override; defaults to the platform origin itself. */
  casUrl?: string
  /** Test hook: called with the harvested session when login completes. */
  onSession: (session: { cookieString: string; jwt: string }) => void
}

/**
 * The SPA stores its JWT in sessionStorage under appName-prefixed keys;
 * appName = the first URL path segment (see the platform bundle).
 * Key names only — values are read inside the window and never logged.
 */
const SESSION_STORAGE_KEYS_SCRIPT = `(function () {
  var appName = (location.pathname.split('/').find(function (p) { return p !== ''; }) || 'JY_');
  return JSON.stringify({
    jwt: sessionStorage.getItem(appName + '_STORAGE_KEY_JWT_TOKEN') || '',
    refresh: localStorage.getItem(appName + '_STORAGE_KEY_REFRESH_TOKEN') || ''
  });
})()`

const PARTITION = 'persist:seu-cas'
/** Wall-clock budget for the first page load (user typing time is not limited). */
export const CAS_LOAD_TIMEOUT_MS = 25_000
/** Budget for the reachability precheck (fails fast before any window). */
export const CAS_PRECHECK_TIMEOUT_MS = 10_000
/** How often the session probe hits the school API while the user logs in. */
export const CAS_POLL_INTERVAL_MS = 3_000
/** API base path on the platform origin (only static UI assets carry the -ui suffix). */
export const PLATFORM_API_BASE_PATH = '/jy-application-resourcemanage'
/** API path used to detect that the session works (course list pagination, jwt-token authenticated). */
export const SESSION_PROBE_PATH = '/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=1'

const LOADING_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<style>body{font-family:"Segoe UI",system-ui,sans-serif;background:#f5f6f8;' +
  'color:#1c1e21;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
  '.box{text-align:center}.spinner{width:28px;height:28px;border:3px solid #d9dde3;' +
  'border-top-color:#2563eb;border-radius:50%;margin:0 auto 14px;animation:s .8s linear infinite}' +
  '@keyframes s{to{transform:rotate(360deg)}}</style></head>' +
  '<body><div class="box"><div class="spinner"></div><p>正在打开 SEU 平台登录页…</p></div></body></html>'

/** Human-readable failure message; never includes cookies or full URLs. */
export function casLoadErrorMessage(kind: 'timeout' | 'load' | 'precheck', detail: string): string {
  const hint = '请确认校园网内网或 VPN 可访问录播平台后重试'
  if (kind === 'precheck') return `录播平台无法连接（${detail}）。${hint}`
  if (kind === 'timeout') {
    const stage = detail === '' ? '' : `，阶段：${detail}`
    return `录播平台响应超时（${CAS_LOAD_TIMEOUT_MS / 1000} 秒${stage}）。${hint}`
  }
  return `录播平台登录页加载失败（${detail}）。${hint}`
}

/** Quick reachability check so a dead network fails fast instead of a white window. */
async function precheck(casUrl: string): Promise<void> {
  try {
    await fetch(casUrl, { method: 'HEAD', signal: AbortSignal.timeout(CAS_PRECHECK_TIMEOUT_MS) })
  } catch (err) {
    throw new Error(casLoadErrorMessage('precheck', (err as Error).message))
  }
}

/**
 * Diagnostic network trace: records request paths (query KEYS only, never
 * values/cookies/tokens) of the login flow plus post-login endpoint probes,
 * to userData/logs/net-trace.log. Low volume (one login = a handful of
 * lines); helps field diagnosis of platform API differences without
 * touching secrets. Every line passes redact() and the file rotates on a
 * 7-day age — the trace must not become an unredacted, unbounded log
 * (review 2026-09-05 A4).
 */
const TRACE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Safe URL form for tracing: origin+path, query key names only. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}${u.search ? `?${[...u.searchParams.keys()].join('&')}` : ''}`
  } catch {
    return '[URL]'
  }
}

function traceLine(line: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'net-trace.log')
    try {
      if (Date.now() - statSync(file).mtimeMs > TRACE_MAX_AGE_MS) rmSync(file, { force: true })
    } catch {
      // Absent file is the common case.
    }
    appendFileSync(file, `${new Date().toISOString()} ${redact(line)}\n`)
  } catch {
    // Diagnostics must never break the login flow.
  }
}

function traceSession(ses: Session): void {
  ses.webRequest.onBeforeRequest((details) => {
    try {
      const u = new URL(details.url)
      if (/\.(js|css|png|jpg|jpeg|gif|woff2?|svg|ico|ttf|mp4)$/i.test(u.pathname)) return
      traceLine(`${details.method} ${u.origin}${u.pathname}${u.search ? `?${[...u.searchParams.keys()].join('&')}` : ''}`)
    } catch {
      // Ignore unparsable URLs.
    }
  })
}

/** Post-login endpoint probes (diagnostics): which platform APIs answer with JSON. */
async function tracePostLoginProbes(cookieHeader: string, serviceOrigin: string, jwt: string): Promise<void> {
  const apiBase = `${serviceOrigin}${PLATFORM_API_BASE_PATH}`
  const candidates: Array<{ path: string; method: 'GET' | 'POST' }> = [
    { path: '/v1/group_subject_vod_list/t-1?page.pageIndex=1&page.pageSize=5', method: 'GET' },
    { path: '/v1/course/verify?courId=154592', method: 'GET' },
    { path: '/authority/me', method: 'GET' }
  ]
  for (const candidate of candidates) {
    try {
      const res = await fetch(`${apiBase}${candidate.path}`, {
        method: candidate.method,
        headers: {
          Cookie: cookieHeader,
          'jwt-token': jwt,
          'Content-Type': 'application/json;charset=utf-8'
        },
        signal: AbortSignal.timeout(6000)
      })
      const body = await res.text()
      traceLine(`PROBE ${candidate.method} ${candidate.path} -> ${res.status} ${describeJsonShape(body)}`)
    } catch (err) {
      traceLine(`PROBE ${candidate.method} ${candidate.path} -> ERR ${(err as Error).message}`)
    }
  }
}

/**
 * Field-name shape of a JSON body, depth-capped (t-1 nests course fields at
 * result.records[]). Key names, counts and types only — never values.
 */
export function describeJsonShape(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown
    if (parsed == null || typeof parsed !== 'object') return typeof parsed
    return `json${describeValueShape(parsed, 2)}`
  } catch {
    return `non-json(${body.length}b)`
  }
}

/** Shape of one JSON value: `{fields}` for objects, `[n]{elem}` for arrays. */
function describeValueShape(value: unknown, depth: number): string {
  if (value == null || typeof value !== 'object') return typeof value
  if (Array.isArray(value)) {
    const first: unknown = value.length > 0 ? value[0] : undefined
    // Object elements carry their own braces; scalars render as their type.
    return `[${value.length}]${first === undefined ? '' : describeValueShape(first, depth)}`
  }
  if (depth <= 0) return '{…}'
  const fields = Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => {
      if (child != null && typeof child === 'object') {
        // Arrays are transparent (no named level): the element shape keeps
        // the current depth so record fields stay visible.
        return `${key}${describeValueShape(child, Array.isArray(child) ? depth : depth - 1)}`
      }
      return key
    })
    .join(',')
  return `{${fields}}`
}

/** Best-effort JWT read from the login window's sessionStorage ('' when unavailable). */
async function readWindowJwt(win: BrowserWindow): Promise<string> {
  try {
    if (win.isDestroyed() || win.webContents.isLoading()) return ''
    const raw = await win.webContents.executeJavaScript(SESSION_STORAGE_KEYS_SCRIPT, true)
    return (JSON.parse(raw) as { jwt?: string }).jwt ?? ''
  } catch {
    return ''
  }
}

/**
 * The platform's own session: a 2xx JSON body carrying the platform's
 * business envelope (code/result/data — the shapes findCourseArray tolerates)
 * and no login-page markers. A bare 2xx JSON injected by an interception
 * layer must not read as logged in.
 */
export function probeSaysLoggedIn(status: number, body: string): boolean {
  const trimmed = body.trim()
  if (status < 200 || status >= 300) return false
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  if (isCasLoginRedirect(trimmed)) return false
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed == null || typeof parsed !== 'object') return false
    if (Array.isArray(parsed)) return true
    return ['code', 'result', 'data'].some((key) => key in (parsed as Record<string, unknown>))
  } catch {
    return false
  }
}

export async function openCasLoginWindow(options: CasLoginOptions): Promise<void> {
  const casUrl = options.casUrl ?? options.serviceOrigin
  await precheck(casUrl)
  // Field 2026-09-02: data: and http(s) loadURL navigations on this machine
  // never commit (start only, field case below) while file:// loads reliably
  // — so the loading page is a file:// document that navigates itself to the
  // platform from the renderer side. SEU_DIAG_URL replaces the platform
  // target to isolate the platform jump; SEU_DIAG_DEFAULT_SESSION=1 uses the
  // default session to isolate the persist:seu-cas partition; SEU_DIAG_SHOW=1
  // creates the window visible.
  const diagUrl = process.env.SEU_DIAG_URL ?? ''
  const platformUrl = diagUrl !== '' ? diagUrl : casUrl
  const startVisible = process.env.SEU_DIAG_SHOW === '1'
  const ses = process.env.SEU_DIAG_DEFAULT_SESSION === '1' ? session.defaultSession : session.fromPartition(PARTITION)
  traceSession(ses)
  traceLine(
    `LOGIN window open (net=${directNetRequested(process.argv, process.env.SEU_DIRECT_NET) ? 'direct' : 'default'})`
  )

  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'SEU 平台登录',
    show: startVisible,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Field 2026-09-02: the first navigation sometimes never commits. These
  // pins localize the stall — start without commit points at the renderer /
  // network-service side, gone/unresponsive at the process level. (NAV commit
  // is traced by the did-navigate handler below.)
  win.webContents.on(
    'did-start-navigation',
    (_details: Event<WebContentsDidStartNavigationEventParams>, url: string) => traceLine(`NAV start ${describeUrl(url)}`)
  )
  win.webContents.on('did-finish-load', () => traceLine('NAV finish'))
  win.webContents.on('unresponsive', () => traceLine('NAV renderer unresponsive'))
  win.webContents.on('render-process-gone', (_event: Event, details: RenderProcessGoneDetails) =>
    traceLine(`NAV renderer gone ${details.reason}`)
  )

  return await new Promise((resolve, reject) => {
    let settled = false
    let pollTimer: NodeJS.Timeout | undefined
    let firstPaintTimer: NodeJS.Timeout | undefined
    // The platform redirects to auth.seu.edu.cn for sign-in and lands back
    // on the origin afterwards; that round-trip is the primary "logged in"
    // signal (the API probe is the fallback for an existing session).
    let leftOrigin = false

    const fail = (message: string): void => {
      if (settled) return
      settled = true
      if (pollTimer != null) clearInterval(pollTimer)
      if (firstPaintTimer != null) {
        clearTimeout(firstPaintTimer)
        firstPaintTimer = undefined
      }
      traceLine(`FAIL ${message.slice(0, 200)}`)
      if (!win.isDestroyed()) win.destroy()
      reject(new Error(message))
    }

    const finish = async (code: 'ok' | 'closed'): Promise<void> => {
      if (settled) return
      settled = true
      if (pollTimer != null) clearInterval(pollTimer)
      try {
        if (code === 'ok') {
          // The landing page writes its JWT to sessionStorage shortly after
          // the redirect completes; give it a moment before harvesting.
          await new Promise((r) => setTimeout(r, 1500))
          const cookies = await ses.cookies.get({ url: options.serviceOrigin })
          const merged = mergeCookieStrings('', cookies.map((c) => `${c.name}=${c.value}`).join('; '))
          const jwt = await readWindowJwt(win)
          options.onSession({ cookieString: merged, jwt })
          void tracePostLoginProbes(merged, options.serviceOrigin, jwt)
        }
      } finally {
        // --seu-trace-keep-window (field diagnosis): keep the window open so
        // the user can walk into course pages while every request is traced.
        if (!win.isDestroyed() && !process.argv.includes('--seu-trace-keep-window')) win.close()
        if (code === 'ok') resolve()
        else reject(new Error('CAS login window closed before login completed'))
      }
    }

    // Poll the school API with the window session's cookies; success means
    // the user has completed the platform login inside the window.
    const startPolling = (): void => {
      pollTimer = setInterval(() => {
        if (settled || win.isDestroyed()) {
          if (pollTimer != null) clearInterval(pollTimer)
          return
        }
        void (async () => {
          try {
            // The API is jwt-token authenticated; send it when the SPA has
            // already written one to sessionStorage.
            const jwt = await readWindowJwt(win)
            const headers: Record<string, string> = {}
            if (jwt !== '') headers['jwt-token'] = jwt
            const res = await ses.fetch(
              `${options.serviceOrigin}${PLATFORM_API_BASE_PATH}${SESSION_PROBE_PATH}`,
              { headers }
            )
            const body = await res.text()
            if (probeSaysLoggedIn(res.status, body)) await finish('ok')
          } catch {
            // Not logged in yet (or probe failed) — keep polling.
          }
        })()
      }, CAS_POLL_INTERVAL_MS)
    }

    // Redirect away from the platform (auth.seu.edu.cn) and back = done.
    // The FIRST arrival on the platform origin clears the first-paint budget
    // and starts the session probe — the loading page navigates itself here.
    let platformArrived = false
    win.webContents.on('did-navigate', (_e, url) => {
      if (settled) return
      traceLine(`NAV commit ${describeUrl(url)}`)
      if (!platformArrived && url.startsWith(options.serviceOrigin)) {
        platformArrived = true
        traceLine('PLATFORM page committed')
        if (firstPaintTimer != null) {
          clearTimeout(firstPaintTimer)
          firstPaintTimer = undefined
        }
        startPolling()
        return
      }
      if (!url.startsWith(options.serviceOrigin)) {
        leftOrigin = true
        return
      }
      if (leftOrigin && !isCasLoginRedirect(url)) void finish('ok')
    })

    // ERR_ABORTED (-3) happens when a navigation is interrupted by another
    // one — not a real failure.
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      if (settled || code === -3) return
      fail(casLoadErrorMessage('load', desc || `错误码 ${code}`))
    })

    win.on('closed', () => {
      if (!settled) {
        settled = true
        if (firstPaintTimer != null) {
          clearTimeout(firstPaintTimer)
          firstPaintTimer = undefined
        }
        reject(new Error('CAS login window closed before login completed'))
      }
    })

    // Show the local loading page immediately, then the page itself navigates
    // to the platform. One wall-clock budget covers window creation → loading
    // page → platform first commit: without it a hang on any of those steps is
    // invisible (no error, no window, no timeout — field case 2026-09-01).
    // The user's typing time after the platform page loads is not limited.
    firstPaintTimer = setTimeout(() => fail(casLoadErrorMessage('timeout', '首帧')), CAS_LOAD_TIMEOUT_MS)
    win.once('ready-to-show', () => win.show())
    // file:// loads reliably on this machine while data:/http loadURL navigations
    // never commit (field case 2026-09-02) — the loading page jumps to the
    // platform itself, renderer-side.
    const loadingPath = join(tmpdir(), `seu-login-loading-${process.pid}.html`)
    const jump = `<script>setTimeout(function(){location.replace(${JSON.stringify(platformUrl)})},250)</script>`
    writeFileSync(loadingPath, LOADING_HTML.replace('</body>', `${jump}</body>`))
    void win
      .loadFile(loadingPath)
      .then(() => {
        if (settled) return
        traceLine('LOADING page ready -> renderer navigates to platform')
      })
      .catch((err) => fail(`登录窗口初始化失败: ${(err as Error).message}`))
      .finally(() => {
        rmSync(loadingPath, { force: true })
      })
  })
}
