import { describe, expect, it, afterEach, vi } from 'vitest'
import { NAV_ALLOWED_HOST_SUFFIXES, attachNavigationGuards, isAppOrSchoolUrl } from '../src/main/nav-guard'
import { attachLoginWindowGuards } from '../src/main/auth/cas-login'

// nav-guard reads app.isPackaged inside the guard; the node test environment
// has no Electron runtime, so the platform layer is mocked (same pattern as
// tests/ipc-settings.test.ts). electronApp is mutable so the I1 case can flip
// isPackaged and prove the login-window guard uses the same gate as the main
// window guard (dev-server prefix only when NOT packaged).
const electronApp = vi.hoisted(() => ({ isPackaged: false }))
vi.mock('electron', () => ({ app: electronApp, BrowserWindow: undefined }))

describe('isAppOrSchoolUrl — 批1 契约：file:// 不再整体放行', () => {
  it('rejects a bare local file page', () => {
    expect(isAppOrSchoolUrl('file:///x')).toBe(false)
    expect(isAppOrSchoolUrl('file:///C:/temp/evil.html')).toBe(false)
  })

  it('allows the school hosts and refuses lookalikes (suffix match pinned)', () => {
    expect(isAppOrSchoolUrl('https://auth.seu.edu.cn/x')).toBe(true)
    expect(isAppOrSchoolUrl('https://cvs.seu.edu.cn/vod/play')).toBe(true)
    expect(isAppOrSchoolUrl('https://ids.seu.edu.cn/oauth')).toBe(true)
    expect(NAV_ALLOWED_HOST_SUFFIXES).toEqual(['cvs.seu.edu.cn', 'auth.seu.edu.cn', 'ids.seu.edu.cn'])
    expect(isAppOrSchoolUrl('https://evil.example')).toBe(false)
    expect(isAppOrSchoolUrl('https://cvs.seu.edu.cn.evil.com')).toBe(false)
    expect(isAppOrSchoolUrl('not a url')).toBe(false)
  })

  it('allows the dev-server prefix only when not packaged', () => {
    const dev = { devUrl: 'http://localhost:5173/' }
    expect(isAppOrSchoolUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isAppOrSchoolUrl('http://localhost:5173/app', dev)).toBe(true)
    expect(isAppOrSchoolUrl('http://localhost:5173/', { ...dev, packaged: true })).toBe(false)
  })
})

/** webContents double with an event table the test drives manually. */
class FakeWebContents {
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  windowOpenHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | null = null
  permissionHandler: ((wc: unknown, permission: string, callback: (allowed: boolean) => void) => void) | null = null
  readonly session = {
    setPermissionRequestHandler: (fn: (wc: unknown, permission: string, cb: (allowed: boolean) => void) => void): void => {
      this.permissionHandler = fn
    }
  }
  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }
  setWindowOpenHandler(fn: (details: { url: string }) => { action: 'allow' | 'deny' }): void {
    this.windowOpenHandler = fn
  }
  /** Fire every listener for the event; the event object carries url + preventDefault. */
  emit(event: string, url: string): boolean {
    let prevented = false
    const ev = { url, preventDefault: (): void => { prevented = true } }
    for (const listener of this.listeners.get(event) ?? []) listener(ev, url)
    return prevented
  }
}

describe('attachNavigationGuards — 批1: will-navigate/redirect/frame 同判', () => {
  function makeGuardTarget(): { wc: FakeWebContents; warnings: string[] } {
    const wc = new FakeWebContents()
    const warnings: string[] = []
    attachNavigationGuards({ logger: { warn: (m) => warnings.push(m) } }, { webContents: wc } as never)
    return { wc, warnings }
  }

  it('wires will-navigate, will-redirect and will-frame-navigate to the same verdict', () => {
    const { wc, warnings } = makeGuardTarget()
    for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
      expect(wc.listeners.has(event), event).toBe(true)
      expect(wc.emit(event, 'https://cvs.seu.edu.cn/vod/play'), `${event} school host`).toBe(false)
      expect(wc.emit(event, 'https://evil.example/x'), `${event} foreign host`).toBe(true)
    }
    expect(warnings.some((w) => w.includes('blocked navigation'))).toBe(true)
  })

  it('still refuses window.open and denies every permission request', () => {
    const { wc } = makeGuardTarget()
    expect(wc.windowOpenHandler).not.toBeNull()
    expect(wc.windowOpenHandler!({ url: 'https://evil.example/pop' })).toEqual({ action: 'deny' })
    expect(wc.permissionHandler).not.toBeNull()
    const cb = vi.fn()
    wc.permissionHandler!(null, 'media', cb)
    expect(cb).toHaveBeenCalledWith(false)
  })
})

describe('attachLoginWindowGuards — 批1: 登录窗只放行学校主机', () => {
  afterEach(() => {
    electronApp.isPackaged = false
    delete process.env.ELECTRON_RENDERER_URL
  })

  it('blocks off-school navigations and popups, allows the platform jump', () => {
    const wc = new FakeWebContents()
    const lines: string[] = []
    attachLoginWindowGuards(wc as never, (line) => lines.push(line), '')
    expect(wc.emit('will-navigate', 'https://cvs.seu.edu.cn/')).toBe(false)
    expect(wc.emit('will-navigate', 'https://evil.example/x')).toBe(true)
    expect(wc.emit('will-navigate', 'file:///C:/temp/evil.html')).toBe(true)
    expect(wc.windowOpenHandler).not.toBeNull()
    expect(wc.windowOpenHandler!({ url: 'https://evil.example/pop' })).toEqual({ action: 'deny' })
    expect(lines.some((l) => l.includes('blocked login navigation'))).toBe(true)
  })

  it('keeps the SEU_DIAG_URL diagnostic seam working', () => {
    const wc = new FakeWebContents()
    attachLoginWindowGuards(wc as never, () => undefined, 'https://diag.example/platform')
    expect(wc.emit('will-navigate', 'https://diag.example/platform')).toBe(false)
  })

  it('refuses the dev-server prefix when packaged (I1: same gate as the main-window guard)', () => {
    const wc = new FakeWebContents()
    electronApp.isPackaged = true
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
    attachLoginWindowGuards(wc as never, () => undefined, '')
    expect(wc.emit('will-navigate', 'http://localhost:5173/')).toBe(true)
    // 未打包时才放行 dev 前缀。
    electronApp.isPackaged = false
    expect(wc.emit('will-navigate', 'http://localhost:5173/')).toBe(false)
  })
})
