import { app, type BrowserWindow } from 'electron'

/**
 * E2 (review): the main window legitimately navigates to the school
 * platform (login, play-page harvest) — but nothing else. Pin navigation
 * to the app itself and the school hosts, refuse window.open popups, and
 * deny every permission request.
 */
export const NAV_ALLOWED_HOST_SUFFIXES = ['cvs.seu.edu.cn', 'auth.seu.edu.cn', 'ids.seu.edu.cn']

export interface NavUrlOptions {
  /** Dev-server URL (ELECTRON_RENDERER_URL): allowed as a prefix only when not packaged. */
  devUrl?: string
  /** True on packaged builds — the dev-server prefix is refused there. */
  packaged?: boolean
}

/**
 * 批1 (audit 2026-09-19): file:// used to be accepted wholesale, so any
 * local document could navigate the window anywhere. The UI itself is
 * loaded by main-side loadFile (programmatic — never fires will-navigate),
 * so no legitimate page-initiated file: navigation exists → drop it.
 */
export function isAppOrSchoolUrl(url: string, opts: NavUrlOptions = {}): boolean {
  const devUrl = opts.devUrl ?? process.env.ELECTRON_RENDERER_URL
  // 批1: the dev-server escape hatch is gated on !packaged — a stray
  // ELECTRON_RENDERER_URL must not remotely take over a packaged install.
  if (opts.packaged !== true && devUrl != null && devUrl !== '' && url.startsWith(devUrl)) return true
  try {
    const parsed = new URL(url)
    return NAV_ALLOWED_HOST_SUFFIXES.some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith('.' + suffix))
  } catch {
    return false
  }
}

export interface NavGuardContext {
  logger: { warn(message: string): void }
}

/**
 * 批1 (audit 2026-09-19): will-redirect / will-frame-navigate share the
 * will-navigate verdict — will-navigate alone only catches user/page-initiated
 * navigations, so server 302s and frame navigations slipped past. School-host
 * 302s (login/harvest depend on them) stay allowed; everything else is refused.
 */
export function attachNavigationGuards(ctx: NavGuardContext, win: BrowserWindow): void {
  // will-navigate/will-redirect pass the url as the 2nd argument; will-frame-navigate
  // carries it on the event only — the guard reads both.
  const guard = (event: { preventDefault(): void; url?: string }, url?: string): void => {
    const target = url ?? event.url ?? ''
    if (isAppOrSchoolUrl(target, { packaged: app.isPackaged })) return
    event.preventDefault()
    ctx.logger.warn(`blocked navigation to ${target.split('?')[0] ?? ''}`)
  }
  win.webContents.on('will-navigate', guard)
  win.webContents.on('will-redirect', guard)
  win.webContents.on('will-frame-navigate', guard)
  win.webContents.setWindowOpenHandler(({ url }) => {
    ctx.logger.warn(`blocked window.open to ${url.split('?')[0] ?? ''}`)
    return { action: 'deny' }
  })
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    ctx.logger.warn(`denied permission request: ${permission}`)
    callback(false)
  })
}
