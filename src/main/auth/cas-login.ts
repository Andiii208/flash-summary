/**
 * In-app CAS login window.
 *
 * Opens a hidden-until-loaded BrowserWindow on a dedicated persistent
 * session partition. When navigation lands back on the target origin
 * (post-login redirect), cookies are harvested and the window closes.
 * Cookie values are never logged.
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

export async function openCasLoginWindow(options: CasLoginOptions): Promise<void> {
  const casUrl = options.casUrl ?? `https://ids.seu.edu.cn/authserver/login?service=${encodeURIComponent(options.serviceOrigin)}`
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

    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (!settled) {
        settled = true
        reject(new Error(`CAS login failed to load: ${code} ${desc} at ${url}`))
      }
    })

    win.on('closed', () => {
      if (!settled) {
        settled = true
        reject(new Error('CAS login window closed before login completed'))
      }
    })

    win.once('ready-to-show', () => win.show())
    void win.loadURL(casUrl)
  })
}
