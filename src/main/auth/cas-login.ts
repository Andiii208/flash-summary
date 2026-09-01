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
import { BrowserWindow, session } from 'electron'
import { mergeCookieStrings, isCasLoginRedirect } from '../school/api-parse'

export interface CasLoginOptions {
  /** e.g. https://cvs.seu.edu.cn */
  serviceOrigin: string
  /** Login page override; defaults to the platform origin itself. */
  casUrl?: string
  /** Test hook: called with merged cookie string when login completes. */
  onSession: (cookieString: string) => void
}

const PARTITION = 'persist:seu-cas'
/** Wall-clock budget for the first page load (user typing time is not limited). */
export const CAS_LOAD_TIMEOUT_MS = 25_000
/** Budget for the reachability precheck (fails fast before any window). */
export const CAS_PRECHECK_TIMEOUT_MS = 10_000
/** How often the session probe hits the school API while the user logs in. */
export const CAS_POLL_INTERVAL_MS = 3_000
/** API path used to detect that the session works. */
export const SESSION_PROBE_PATH = '/v1/course/list'

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
  if (kind === 'timeout') return `录播平台响应超时（${CAS_LOAD_TIMEOUT_MS / 1000} 秒）。${hint}`
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

/** The platform's own session: a 2xx JSON body that is not a login page. */
function probeSaysLoggedIn(status: number, body: string): boolean {
  const trimmed = body.trim()
  return status >= 200 && status < 300 && (trimmed.startsWith('{') || trimmed.startsWith('[')) && !isCasLoginRedirect(trimmed)
}

export async function openCasLoginWindow(options: CasLoginOptions): Promise<void> {
  const casUrl = options.casUrl ?? options.serviceOrigin
  await precheck(casUrl)
  const ses = session.fromPartition(PARTITION)

  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'SEU 平台登录',
    show: false,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  return await new Promise((resolve, reject) => {
    let settled = false
    let pollTimer: NodeJS.Timeout | undefined
    // The platform redirects to auth.seu.edu.cn for sign-in and lands back
    // on the origin afterwards; that round-trip is the primary "logged in"
    // signal (the API probe is the fallback for an existing session).
    let leftOrigin = false

    const fail = (message: string): void => {
      if (settled) return
      settled = true
      if (pollTimer != null) clearInterval(pollTimer)
      if (!win.isDestroyed()) win.destroy()
      reject(new Error(message))
    }

    const finish = async (code: 'ok' | 'closed'): Promise<void> => {
      if (settled) return
      settled = true
      if (pollTimer != null) clearInterval(pollTimer)
      try {
        if (code === 'ok') {
          const cookies = await ses.cookies.get({ url: options.serviceOrigin })
          const merged = mergeCookieStrings('', cookies.map((c) => `${c.name}=${c.value}`).join('; '))
          options.onSession(merged)
        }
      } finally {
        if (!win.isDestroyed()) win.close()
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
            const res = await ses.fetch(`${options.serviceOrigin}${SESSION_PROBE_PATH}`)
            const body = await res.text()
            if (probeSaysLoggedIn(res.status, body)) await finish('ok')
          } catch {
            // Not logged in yet (or probe failed) — keep polling.
          }
        })()
      }, CAS_POLL_INTERVAL_MS)
    }

    // Redirect away from the platform (auth.seu.edu.cn) and back = done.
    win.webContents.on('did-navigate', (_e, url) => {
      if (settled) return
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
        reject(new Error('CAS login window closed before login completed'))
      }
    })

    // Show the local loading page immediately, then load the platform login
    // page with a wall-clock budget so a dead upstream can't hang a white
    // window. The user's typing time afterwards is not limited.
    win.once('ready-to-show', () => win.show())
    void win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`)
      .then(() => {
        if (settled) return
        const load = win.loadURL(casUrl)
        const timer = setTimeout(() => fail(casLoadErrorMessage('timeout', '')), CAS_LOAD_TIMEOUT_MS)
        void load
          .then(() => startPolling())
          .catch(() => undefined)
          .finally(() => clearTimeout(timer))
      })
      .catch((err) => fail(`登录窗口初始化失败: ${(err as Error).message}`))
  })
}
