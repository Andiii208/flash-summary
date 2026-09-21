import { describe, expect, it, afterEach, vi } from 'vitest'

// 终审修复波 B1: createMainWindow 的 packaged 钉住测试。安装版 + 本机残留
// ELECTRON_RENDERER_URL 曾经让窗口 loadURL 远程页面——assertAppSender
// （packaged 时已不放行 dev 前缀）会拒掉一切 IPC，应用自我锁死。现在 packaged
// 一律走 loadFile。electron 在此 mock：requestSingleInstanceLock 返回 false，
// 模块级只跑到 app.quit()，whenReady 注册表永远为空，import 无副作用。
const electronApp = vi.hoisted(() => ({ isPackaged: false }))
const loadCalls = vi.hoisted(() => ({ entries: [] as string[] }))
const fakeWindows = vi.hoisted(() => ({ instances: [] as Array<{ options: unknown }> }))
vi.mock('electron', () => {
  class FakeBrowserWindow {
    readonly options: unknown
    // P28 (plan 2026-09-21): createMainWindow 订阅 did-finish-load/resize 做窗口
    // 缩放——fake 补齐 webContents 面（getURL 返回 '' 表示尚未导航，缩放应用会
    // 自行早退，本测试只钉加载入口）。
    readonly webContents = {
      on: vi.fn(),
      getURL: () => '',
      getZoomFactor: () => 1,
      setZoomFactor: vi.fn()
    }
    constructor(options: unknown) {
      this.options = options
      fakeWindows.instances.push(this)
    }
    loadURL(url: string): Promise<void> {
      loadCalls.entries.push(`url:${url}`)
      return Promise.resolve()
    }
    loadFile(path: string): Promise<void> {
      loadCalls.entries.push(`file:${path}`)
      return Promise.resolve()
    }
    on(): this {
      return this
    }
  }
  return {
    app: {
      get isPackaged(): boolean {
        return electronApp.isPackaged
      },
      setPath: vi.fn(),
      getPath: () => 'C:\\tmp',
      getAppPath: () => 'C:\\tmp',
      requestSingleInstanceLock: () => false,
      quit: vi.fn(),
      on: vi.fn(),
      whenReady: () => new Promise<void>(() => undefined),
      commandLine: { appendSwitch: vi.fn() }
    },
    BrowserWindow: FakeBrowserWindow,
    dialog: {},
    ipcMain: {},
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
    nativeTheme: { shouldUseDarkColors: false },
    session: { defaultSession: {} },
    Tray: class {},
    Menu: { buildFromTemplate: () => ({}) }
  }
})

const { createMainWindow } = await import('../src/main/index')

describe('createMainWindow — 终审修复波 B1: packaged 门', () => {
  afterEach(() => {
    electronApp.isPackaged = false
    delete process.env.ELECTRON_RENDERER_URL
    loadCalls.entries.length = 0
    fakeWindows.instances.length = 0
  })

  it('packaged builds load the bundled file even when ELECTRON_RENDERER_URL is set', () => {
    electronApp.isPackaged = true
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
    createMainWindow()
    expect(loadCalls.entries).toHaveLength(1)
    expect(loadCalls.entries[0]?.startsWith('file:')).toBe(true)
    expect(loadCalls.entries[0]).toContain('renderer')
  })

  it('unpackaged builds still honor the dev-server URL', () => {
    electronApp.isPackaged = false
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
    createMainWindow()
    expect(loadCalls.entries).toEqual(['url:http://localhost:5173/'])
  })
})
