import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, session, Tray, Menu } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { APP_TITLE } from '../shared/types'
import { createContext } from './app-context'
import { registerIpc, setAppRendererOrigin, webContentsSender } from './ipc'
import { createUpdateController } from './update'
import { attachNavigationGuards, loadMainRenderer, rendererDevUrl, rendererIndexPath } from './nav-guard'
import { DIRECT_NET_SWITCHES, PROXY_BYPASS_RULES, directNetRequested } from './net-diagnostics'
import { Logger } from './logger'
import { binaryFingerprint } from './media/binaries'
import { installProcessGuards } from './process-guards'
import { zoomFactorForWidth, ZOOM_EPSILON } from './window-zoom'

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
  tray.setToolTip('Flash Summary — 任务后台运行中')
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

/**
 * 批1: the renderer entry the app actually loads — the dev-server URL in
 * unpackaged dev runs, the packaged file URL otherwise. Injected into
 * ipc.ts so assertAppSender can compare file:// callers against it exactly.
 * 终审修复波 B1: 判定与两处窗口加载入口共用 nav-guard 的 rendererDevUrl——
 * 同一份 packaged 门，三处不再各读 env。
 */
function appRendererEntryUrl(): string {
  return rendererDevUrl(app.isPackaged) ?? pathToFileURL(rendererIndexPath()).href
}

export function createMainWindow(onLoadError?: (message: string) => void): BrowserWindow {
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

  // A failed renderer load (dev server gone, corrupted bundle) used to die as
  // a bare void rejection — no window content, zero log lines. 批5: route it
  // into the logger. 终审修复波 B1: packaged 门收在 loadMainRenderer 内。
  const onLoadFailure = (err: unknown): void => onLoadError?.(`renderer load failed: ${(err as Error).message ?? String(err)}`)
  void loadMainRenderer(win).catch(onLoadFailure)

  // P28 (plan 2026-09-21): 窗口级等比例缩放。did-finish-load 应用初值（加载前设
  // 可能被导航重置）；resize 时按档位变化更新——只在不同档位才调
  // setZoomFactor，拖拽期约每 32px 重排一次（ZOOM_EPSILON）。CSS 视口随之钉在
  // 1600：宽屏下布局与 1600 窗口逐像素同一、只是物理放大。getContentBounds 取
  // 客户区宽（Windows 隐形边框约 14px 不计入——用 getBounds 会让视口钉在
  // 1600−14）。登录窗是另一个 BrowserWindow，不挂这套（cas-login.ts）。
  const applyWindowZoom = (): void => {
    if (win.webContents.getURL() === '') return
    const target = zoomFactorForWidth(win.getContentBounds().width)
    if (Math.abs(target - win.webContents.getZoomFactor()) > ZOOM_EPSILON) {
      win.webContents.setZoomFactor(target)
    }
  }
  win.webContents.on('did-finish-load', applyWindowZoom)
  win.on('resize', applyWindowZoom)

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
      // 批5: 进程级异常兜底——未处理的 rejection / 未捕获异常落日志而不是
      // 无声杀进程（无 crashReporter，退出即丢现场；uncaughtException 记录
      // 后不退出，见 process-guards.ts 的取舍注释）。
      installProcessGuards(ctx.logger)
      mainWindow = createMainWindow((line) => ctx.logger.error(line))
      // In-window navigation flows (play-page harvest, embedded login) drive
      // this window from main; recreated windows replace the reference.
      ctx.setMainWindow(mainWindow)
      bindWindowLifecycle(ctx, mainWindow)
      attachNavigationGuards(ctx, mainWindow)
      // 批1: IPC handler 的调用方校验（ipc.ts assertAppSender）只认应用自己的
      // renderer 入口 URL——启动时算一次并注入，之后 handler 精确比对。
      setAppRendererOrigin(appRendererEntryUrl())
      // The main window reference lets IPC push task progress to the renderer.
      // H3 (review): audit trail for the bundled media binaries.
      ctx.logger.info(
        `media binaries: ffmpeg=${ctx.ffmpegPath()} (${binaryFingerprint(ctx.ffmpegPath())}), ` +
          `ffprobe=${ctx.ffprobePath()} (${binaryFingerprint(ctx.ffprobePath())})`
      )
      // 2026-09-30 (plan 2026-09-30-public-release-autoupdate): 更新控制器——
      // 全应用唯一一处 import electron-updater。autoDownload=false（下载前必须
      // 经用户在设置页弹层确认）与 autoInstallOnAppQuit=true（用户点「稍后」
      // 后，下载好的包在下次退出时自动装上）在 createUpdateController 里设。
      const updateController = createUpdateController({ app, updater: autoUpdater })
      const ipcHandle = registerIpc(ctx, ipcMain, { sender: webContentsSender(mainWindow), updateController })
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
          // The window can be destroyed while the message box is up (task
          // cancel path) — that rejects this promise; nothing left to do.
          .catch(() => undefined)
      })
      mainWindow.on('closed', () => {
        if (unsubscribeIdle != null) unsubscribeIdle()
        destroyTray()
      })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindow = createMainWindow((line) => ctx.logger.error(line))
          ctx.setMainWindow(mainWindow)
          attachNavigationGuards(ctx, mainWindow)
          bindWindowLifecycle(ctx, mainWindow)
          // registerIpc now clears its previous handlers before re-registering,
          // so a recreated window gets a fresh progress sender.
          ipcHandleRef = registerIpc(ctx, ipcMain, { sender: webContentsSender(mainWindow), updateController })
        }
      })
    } catch (err) {
      const message = (err as Error).message ?? String(err)
      earlyLogger.error(`startup failed: ${message}`)
      void dialog.showErrorBox(
        'Flash Summary 启动失败',
        `资料库初始化失败：${message}\n\n日志目录：${logsDir}\n请把日志发给开发者或在安全模式下重装。`
      )
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
