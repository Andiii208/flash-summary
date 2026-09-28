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
import { BrowserWindow, session, app, type Session, type Event, type OnBeforeRequestListenerDetails, type RenderProcessGoneDetails, type WebContents, type WebContentsDidStartNavigationEventParams } from 'electron'
import { mergeCookieStrings, isCasLoginRedirect } from '../school/api-parse'
// H30 (audit 2026-09-28): 平台路径常量族的事实源在 school 域（见 platform-paths.ts
// 文件头）。auth → school 是许可的依赖方向；反向（school → auth）已消除。
import { PLATFORM_API_BASE_PATH, SESSION_PROBE_PATH } from '../school/platform-paths'
import { isAppOrSchoolUrl } from '../nav-guard'
import { directNetRequested } from '../net-diagnostics'
import { sessionAwareFetch } from '../net-fetch'
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
// H30 (audit 2026-09-28): 平台路径常量族上移 school/platform-paths（play-harvest
// 也曾反向来本模块 import 它，分层倒置）。这里再导出一次，兼容既有测试与调用方
// 的 import 路径；唯一事实源是 school/platform-paths.ts。
export { PLATFORM_API_BASE_PATH, SESSION_PROBE_PATH } from '../school/platform-paths'

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
    // H2 (audit 2026-09-28): 会话感知 fetch——Chromium 代理对 window 里的网页生效，
    // 对裸 globalThis.fetch 不生效；登录前的探活必须和用户浏览器看到的是同一条路。
    await sessionAwareFetch(casUrl, { method: 'HEAD', signal: AbortSignal.timeout(CAS_PRECHECK_TIMEOUT_MS) })
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

/**
 * 批1 (audit 2026-09-19): 旧写法每次 openCasLoginWindow 都往
 * persist:seu-cas 加一个 onBeforeRequest 且从不移除——旧登录窗路径
 * （SEU_LOGIN_WINDOW=1）下逐次累积、trace 行倍增。现在同一 session 只挂
 * 一次并保存引用，窗口关闭时退订（untraceSession）。
 */
const casTraceSessions = new WeakSet<Session>()
let casTrace: { ses: Session; listener: (details: OnBeforeRequestListenerDetails) => void } | null = null

function traceSession(ses: Session): void {
  if (casTraceSessions.has(ses)) return
  casTraceSessions.add(ses)
  const listener = (details: OnBeforeRequestListenerDetails): void => {
    try {
      const u = new URL(details.url)
      if (/\.(js|css|png|jpg|jpeg|gif|woff2?|svg|ico|ttf|mp4)$/i.test(u.pathname)) return
      traceLine(`${details.method} ${u.origin}${u.pathname}${u.search ? `?${[...u.searchParams.keys()].join('&')}` : ''}`)
    } catch {
      // Ignore unparsable URLs.
    }
  }
  ses.webRequest.onBeforeRequest(listener)
  casTrace = { ses, listener }
}

/**
 * 批1: 登录窗关闭时退订 trace 监听（见 traceSession 的累积问题）。
 * 修复轮 C1：WebRequest 对象模板只注册 on* 方法，removeListener 运行时并不
 * 存在——官方退订方式是把 listener 传 null（d.ts 重载本身接受 null）。旧写法
 * 在这里抛 TypeError，把 closed 处理器后段的 reject 一起跳过。
 */
function untraceSession(ses: Session): void {
  if (casTrace == null || casTrace.ses !== ses) return
  ses.webRequest.onBeforeRequest(null)
  casTrace = null
  casTraceSessions.delete(ses)
}

/**
 * 批1 (audit 2026-09-19): 登录窗渲染的是学校平台页面——把导航钉在学校主机上
 * （loading 页自己跳平台那一下放行），window.open 全拒。SEU_DIAG_URL 是现场
 * 诊断缝，仍然放行，否则诊断流程会被自己人挡死。
 */
export function attachLoginWindowGuards(webContents: WebContents, trace: (line: string) => void, diagUrl: string): void {
  webContents.setWindowOpenHandler(() => {
    trace('blocked window.open in login window')
    return { action: 'deny' }
  })
  webContents.on('will-navigate', (event, url) => {
    // 修复轮 I1：与主窗口守卫同口径——dev 前缀仅未打包放行。
    if (isAppOrSchoolUrl(url, { packaged: app.isPackaged }) || (diagUrl !== '' && url.startsWith(diagUrl))) return
    event.preventDefault()
    trace(`blocked login navigation to ${describeUrl(url)}`)
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
      // H2: 会话感知 fetch（Chromium 网络栈）。原来这里是裸 globalThis.fetch——
      // 代理用户下探活结果与 window 内的真实可达性不一致，诊断日志反而误导。
      const res = await sessionAwareFetch(`${apiBase}${candidate.path}`, {
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
  attachLoginWindowGuards(win.webContents, traceLine, diagUrl)

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

    /**
     * 收尾关窗：--seu-trace-keep-window（现场诊断）下保留窗口，让人能自己走进
     * 课程页看 trace；否则正常关闭。fail() 走 destroy()（硬失败），这里走
     * close()（用户已完成该做的事，只是不再需要这个窗口）。
     */
    const closeLoginWindow = (): void => {
      if (!win.isDestroyed() && !process.argv.includes('--seu-trace-keep-window')) win.close()
    }

    /**
     * H6 (audit 2026-09-28): 登录收尾——**先持久化、后 resolve**。
     *
     * 旧写法把 `resolve()` 放 finally：cookies.get / saveSession / DPAPI 任一抛错
     * 时，finally 照常 resolve、异常顺着 `void finish('ok')`（导航回落）或轮询
     * IIFE 的 catch 逃逸成 unhandledRejection。调用方于是记 success 并写
     * 「login succeeded (session encrypted at rest)」，而磁盘上什么都没有——
     * 用户以为自己登录了，下一次请求又把他弹回登录页。现在失败同样走 reject，
     * 两条触发路径（轮询探活 / 导航回落）共用这一个收尾，行为天然统一。（窗口
     * 在中途被关是另一条路：win.on('closed') 自己 reject，互不抢占。）
     */
    const finish = async (): Promise<void> => {
      if (settled) return
      settled = true
      if (pollTimer != null) clearInterval(pollTimer)
      if (firstPaintTimer != null) {
        clearTimeout(firstPaintTimer)
        firstPaintTimer = undefined
      }
      try {
        // The landing page writes its JWT to sessionStorage shortly after
        // the redirect completes; give it a moment before harvesting.
        await new Promise((r) => setTimeout(r, 1500))
        const cookies = await ses.cookies.get({ url: options.serviceOrigin })
        const merged = mergeCookieStrings('', cookies.map((c) => `${c.name}=${c.value}`).join('; '))
        const jwt = await readWindowJwt(win)
        // 持久化（onSession → saveSession → DPAPI 加密落盘）在这一步：它抛错
        // 就是登录失败，绝不带一个「成功」的幻象返回给调用方。
        options.onSession({ cookieString: merged, jwt })
        void tracePostLoginProbes(merged, options.serviceOrigin, jwt)
        closeLoginWindow()
        resolve()
      } catch (err) {
        const detail = (err as Error).message
        traceLine(`FAIL harvest: ${detail.slice(0, 200)}`)
        closeLoginWindow()
        reject(new Error(`登录成功但会话保存失败，请重试登录（${detail.slice(0, 120)}）`))
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
          let loggedIn = false
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
            loggedIn = probeSaysLoggedIn(res.status, body)
          } catch {
            // Not logged in yet (or probe failed) — keep polling.
            return
          }
          if (!loggedIn) return
          // H6: finish 自己负责把失败原因传播给 openCasLoginWindow 的调用方；
          // 这里显式消费 IIFE 层的重复 rejection——旧写法让它逃逸成
          // unhandledRejection，而外层 promise 早已被 finally resolve 成假成功。
          await finish().catch(() => undefined)
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
      if (leftOrigin && !isCasLoginRedirect(url)) void finish().catch(() => undefined)
    })

    // ERR_ABORTED (-3) happens when a navigation is interrupted by another
    // one — not a real failure.
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      if (settled || code === -3) return
      fail(casLoadErrorMessage('load', desc || `错误码 ${code}`))
    })

    win.on('closed', () => {
      // 批1: 轮询定时器与 trace 监听都随窗口销毁清掉（trace 的累积问题见
      // traceSession；轮询留着会在销毁后继续探活）。
      if (pollTimer != null) clearInterval(pollTimer)
      untraceSession(ses)
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
