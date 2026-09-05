import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, session, Tray, Menu } from 'electron'
import { join } from 'path'
import { APP_TITLE } from '../shared/types'
import { createContext } from './app-context'
import { registerIpc, webContentsSender } from './ipc'
import { DIRECT_NET_SWITCHES, PROXY_BYPASS_RULES, directNetRequested } from './net-diagnostics'
import { Logger } from './logger'
import { binaryFingerprint } from './media/binaries'

let mainWindow: BrowserWindow | null = null
// D4 (review): the close dialog promises «后台继续运行» — hide to tray and
// keep executing instead of destroying the window (which killed the task
// and contradicted the promise). The window restores itself when the queue
// drains (decision 1b: completion must land in front of the user).
let tray: Tray | null = null
/** Module-level ref so the tray's «退出（取消任务）» can cancel the queue. */
let ipcHandleRef: ReturnType<typeof registerIpc> | null = null

function trayIconImage(): Electron.NativeImage {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath ?? '', 'icon.ico')]
    : [join(app.getAppPath(), 'build', 'icon.ico')]
  for (const candidate of candidates) {
    try {
      const image = nativeImage.createFromPath(candidate)
      if (!image.isEmpty()) return image
    } catch {
      // Fall through to the next candidate.
    }
  }
  return nativeImage.createEmpty()
}

function destroyTray(): void {
  if (tray != null) {
    try {
      tray.destroy()
    } catch {
      // Already gone.
    }
    tray = null
  }
}

/** Hide the window and show a tray affordance while tasks run in background. */
function enterBackgroundMode(win: BrowserWindow): void {
  win.hide()
  if (tray != null) return
  tray = new Tray(trayIconImage())
  tray.setToolTip('SEU Summary — 任务后台运行中')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开主窗口',
        click: () => {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
      },
      {
        label: '退出（取消任务）',
        click: () => {
          ipcHandleRef?.cancelRunning()
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

/**
 * E2 (review): the main window legitimately navigates to the school
 * platform (login, play-page harvest) — but nothing else. Pin navigation
 * to the app itself and the school hosts, refuse window.open popups, and
 * deny every permission request.
 */
const NAV_ALLOWED_HOST_SUFFIXES = ['cvs.seu.edu.cn', 'auth.seu.edu.cn', 'ids.seu.edu.cn']

function isAppOrSchoolUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl != null && devUrl !== '' && url.startsWith(devUrl)) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return true
    return NAV_ALLOWED_HOST_SUFFIXES.some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith('.' + suffix))
  } catch {
    return false
  }
}

function attachNavigationGuards(ctx: { logger: { warn(message: string): void } }, win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppOrSchoolUrl(url)) return
    event.preventDefault()
    ctx.logger.warn(`blocked navigation to ${url.split('?')[0] ?? ''}`)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    ctx.logger.warn(`blocked window.open to ${url.split('?')[0] ?? ''}`)
    return { action: 'deny' }
  })
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    ctx.logger.warn(`denied permission request: ${permission}`)
    callback(false)
  })
}

/** D4 decision 1b: when the queue drains, bring the window back. */
function exitBackgroundMode(win: BrowserWindow): void {
  destroyTray()
  if (!win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

// Must run before app ready. See net-diagnostics.ts for the A/B rationale.
if (directNetRequested(process.argv, process.env.SEU_DIRECT_NET)) {
  for (const name of DIRECT_NET_SWITCHES) app.commandLine.appendSwitch(name)
}

// Dev runs must never share state with the installed app: app.getName()
// reads the top-level package.json name for BOTH (productName lives inside
// the build config, not at the top level), so both resolved to
// %APPDATA%\seu-summary and the installed app picked up the dev session
// (field case 2026-09-03). The smoke override below still wins.
if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

// Smoke-test seam (scripts/smoke-cdp.mjs): an isolated userData keeps the
// probe off the real session blob, logs, and single-instance lock (the lock
// is per-userData). Library isolation additionally uses SEU_SUMMARY_DOCS_OVERRIDE.
if (process.env.SEU_SMOKE === '1' && process.env.SEU_SMOKE_USER_DATA != null) {
  app.setPath('userData', process.env.SEU_SMOKE_USER_DATA)
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    // Match the paper-and-ink tokens (style.css) so first paint never flashes
    // white on a dark system (or dark on light).
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0F1211' : '#F5F1E6',
    title: APP_TITLE,
    // The smoke probe drives the window over CDP; keep it invisible there.
    show: process.env.SEU_SMOKE !== '1',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  return win
}

/** Clear the context's window reference when the current main window closes. */
function bindWindowLifecycle(ctx: ReturnType<typeof createContext>, win: BrowserWindow): void {
  win.on('closed', () => ctx.setMainWindow(null))
}

// Single-instance lock (U4): a second launch focuses the existing window
// instead of opening a second process on the same app.db (WAL cross-write).
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow != null) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // C4 (review): a migration/open failure inside createContext used to
    // escape as an unhandled rejection — no window, no dialog, zero log
    // lines. Log first, then fail loudly with the log directory at hand.
    const logsDir = join(app.getPath('userData'), 'logs')
    const earlyLogger = new Logger(logsDir)
    try {
      // Campus domains go direct even when a system proxy is configured (A5):
      // the proxy bypass applies before any window/platform navigation exists.
      await session.defaultSession.setProxy({ mode: 'system', proxyBypassRules: PROXY_BYPASS_RULES })
      const ctx = createContext()
      mainWindow = createMainWindow()
      // In-window navigation flows (play-page harvest, embedded login) drive
      // this window from main; recreated windows replace the reference.
      ctx.setMainWindow(mainWindow)
      bindWindowLifecycle(ctx, mainWindow)
      attachNavigationGuards(ctx, mainWindow)
      // The main window reference lets IPC push task progress to the renderer.
      // H3 (review): audit trail for the bundled media binaries.
      ctx.logger.info(
        `media binaries: ffmpeg=${ctx.ffmpegPath()} (${binaryFingerprint(ctx.ffmpegPath())}), ` +
          `ffprobe=${ctx.ffprobePath()} (${binaryFingerprint(ctx.ffprobePath())})`
      )
      const ipcHandle = registerIpc(ctx, ipcMain, { sender: webContentsSender(mainWindow) })
      ipcHandleRef = ipcHandle

      // M1-3 + D4: closing with a task running must be an informed choice —
      // «后台继续运行» now actually keeps executing (hide to tray), the task
      // finishing restores the window, and «取消任务并退出» cancels for real.
      // destroy() bypasses this handler so the choice is one-shot.
      let unsubscribeIdle: (() => void) | null = null
      mainWindow.on('close', (event) => {
        if (!ipcHandle.isTaskRunning()) return
        const win = mainWindow
        if (win == null || win.isDestroyed()) return
        event.preventDefault()
        void dialog
          .showMessageBox(win, {
            type: 'question',
            buttons: ['后台继续运行', '取消任务并退出', '返回应用'],
            defaultId: 0,
            cancelId: 2,
            title: '任务正在运行',
            message: '有任务正在执行，关闭窗口后任务会怎样？',
            detail: '「后台继续运行」：窗口收到系统托盘，任务继续执行，完成后窗口自动恢复。'
          })
          .then(({ response }) => {
            if (response === 0) {
              enterBackgroundMode(win)
              unsubscribeIdle = ipcHandle.onQueueIdle(() => {
                exitBackgroundMode(win)
              })
            } else if (response === 1) {
              ipcHandle.cancelRunning()
              win.destroy()
            }
          })
      })
      mainWindow.on('closed', () => {
        if (unsubscribeIdle != null) unsubscribeIdle()
        destroyTray()
      })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createMainWindow()
          ctx.setMainWindow(mainWindow)
          attachNavigationGuards(ctx, mainWindow)
          bindWindowLifecycle(ctx, mainWindow)
          ipcHandleRef = registerIpc(ctx, ipcMain, { sender: webContentsSender(mainWindow) })
        }
      })
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      earlyLogger.error(`startup failed: ${message}`)
      void dialog.showErrorBox(
        'SEU Summary 启动失败',
        `资料库初始化失败：${message}\n\n日志目录：${logsDir}\n请把日志发给开发者或在安全模式下重装。`
      )
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
