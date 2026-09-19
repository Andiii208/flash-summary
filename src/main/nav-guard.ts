import { app, type BrowserWindow } from 'electron'
import { join } from 'path'

/**
 * E2 (review): the main window legitimately navigates to the school
 * platform (login, play-page harvest) — but nothing else. Pin navigation
 * to the app itself and the school hosts, refuse window.open popups, and
 * deny every permission request.
 */
export const NAV_ALLOWED_HOST_SUFFIXES = ['cvs.seu.edu.cn', 'auth.seu.edu.cn', 'ids.seu.edu.cn']

/**
 * 终审修复波 B1: the renderer entry a main window loads. Packaged builds
 * ALWAYS load the bundled file — a stray ELECTRON_RENDERER_URL on an
 * installed machine must not navigate the window to a remote page. The
 * remote page would be refused by assertAppSender (packaged 时已不放行
 * dev 前缀），every IPC call would then fail and the app self-locks; worse,
 * restoreMainWindow navigates the window back after login/harvest, which
 * used to yank the user off the app UI onto the remote page.
 */
export function rendererIndexPath(): string {
  return join(__dirname, '../renderer/index.html')
}

/** The dev-server URL to load, or null when the bundled file must win. */
export function rendererDevUrl(packaged: boolean, devUrl = process.env.ELECTRON_RENDERER_URL): string | null {
  if (packaged) return null
  return devUrl != null && devUrl !== '' ? devUrl : null
}

/**
 * B1: the single load branch shared by the two window entries — index.ts
 * createMainWindow and app-context.ts restoreMainWindow. Both used to read
 * the env var themselves without the packaged gate.
 */
export function loadMainRenderer(win: BrowserWindow): Promise<void> {
  const devUrl = rendererDevUrl(app.isPackaged)
  return devUrl !== null ? win.loadURL(devUrl) : win.loadFile(rendererIndexPath())
}

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
