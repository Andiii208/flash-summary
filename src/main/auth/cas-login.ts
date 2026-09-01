/**
 * In-app CAS login window.
 *
 * Flow: reachability precheck (fail fast with a clear message) → a local
 * loading page shown immediately (no white screen) → the CAS page on a
 * dedicated persistent session partition. When navigation lands back on the
 * target origin (post-login redirect), cookies are harvested and the window
 * closes. Cookie values are never logged.
 */
import { BrowserWindow, session } from 'electron'
import { mergeCookieStrings, isCasLoginRedirect } from '../school/api-parse'

export interface CasLoginOptions {
  /** e.g. https://cvs.seu.edu.cn */
  serviceOrigin: string
  /** CAS SSO entry; defaults to SEU ids. */
  casUrl?: string
  /** Test hook: called with merged cookie string when login completes. */
  onSession: (cookieString: string) => void
}

const PARTITION = 'persist:seu-cas'
/** Wall-clock budget for the CAS page to finish loading. */
export const CAS_LOAD_TIMEOUT_MS = 25_000
/** Budget for the reachability precheck (fails fast before any window). */
export const CAS_PRECHECK_TIMEOUT_MS = 10_000

const LOADING_HTML =
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<style>body{font-family:"Segoe UI",system-ui,sans-serif;background:#f5f6f8;' +
  'color:#1c1e21;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
  '.box{text-align:center}.spinner{width:28px;height:28px;border:3px solid #d9dde3;' +
  'border-top-color:#2563eb;border-radius:50%;margin:0 auto 14px;animation:s .8s linear infinite}' +
  '@keyframes s{to{transform:rotate(360deg)}}</style></head>' +
  '<body><div class="box"><div class="spinner"></div><p>正在连接统一身份认证（ids.seu.edu.cn）…</p></div></body></html>'

/** Human-readable failure message; never includes cookies or full URLs. */
export function casLoadErrorMessage(kind: 'timeout' | 'load' | 'precheck', detail: string): string {
  const hint = '请确认校园网内网或 VPN 可访问 ids.seu.edu.cn 后重试'
  if (kind === 'precheck') return `统一身份认证无法连接（${detail}）。${hint}`
  if (kind === 'timeout') return `统一身份认证响应超时（${CAS_LOAD_TIMEOUT_MS / 1000} 秒）。${hint}`
  return `统一身份认证页面加载失败（${detail}）。${hint}`
}

/** Quick reachability check so a dead network fails fast instead of a white window. */
async function precheck(casUrl: string): Promise<void> {
  try {
    await fetch(casUrl, { method: 'HEAD', signal: AbortSignal.timeout(CAS_PRECHECK_TIMEOUT_MS) })
  } catch (err) {
    throw new Error(casLoadErrorMessage('precheck', (err as Error).message))
  }
}

export async function openCasLoginWindow(options: CasLoginOptions): Promise<void> {
  const casUrl = options.casUrl ?? `https://ids.seu.edu.cn/authserver/login?service=${encodeURIComponent(options.serviceOrigin)}`
  await precheck(casUrl)
  const ses = session.fromPartition(PARTITION)

  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'SEU CAS 登录',
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

    const fail = (message: string): void => {
      if (settled) return
      settled = true
      if (!win.isDestroyed()) win.destroy()
      reject(new Error(message))
    }

    const finish = async (code: 'ok' | 'closed'): Promise<void> => {
      if (settled) return
      settled = true
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

    win.webContents.on('did-navigate', (_e, url) => {
      if (!settled && url.startsWith(options.serviceOrigin) && !isCasLoginRedirect(url)) {
        void finish('ok')
      }
    })

    // ERR_ABORTED (-3) happens when a navigation is interrupted by another
    // one (CAS redirects) — not a real failure.
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

    // Show the local loading page immediately, then load the CAS page with
    // a wall-clock budget so a dead upstream can't hang a white window.
    win.once('ready-to-show', () => win.show())
    void win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`)
      .then(() => {
        if (settled) return
        const load = win.loadURL(casUrl)
        const timer = setTimeout(() => fail(casLoadErrorMessage('timeout', '')), CAS_LOAD_TIMEOUT_MS)
        void load.finally(() => clearTimeout(timer)).catch(() => undefined)
      })
      .catch((err) => fail(`登录窗口初始化失败: ${(err as Error).message}`))
  })
}
