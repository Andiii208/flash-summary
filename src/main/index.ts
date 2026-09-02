import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { APP_TITLE } from '../shared/types'
import { createContext } from './app-context'
import { registerIpc, webContentsSender } from './ipc'
import { DIRECT_NET_SWITCHES, directNetRequested } from './net-diagnostics'

let mainWindow: BrowserWindow | null = null

// Must run before app ready. See net-diagnostics.ts for the A/B rationale.
if (directNetRequested(process.argv, process.env.SEU_DIRECT_NET)) {
  for (const name of DIRECT_NET_SWITCHES) app.commandLine.appendSwitch(name)
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

  app.whenReady().then(() => {
    const ctx = createContext()
    mainWindow = createMainWindow()
    // The main window reference lets IPC push task progress to the renderer.
    registerIpc(ctx, ipcMain, { sender: webContentsSender(mainWindow) })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
        registerIpc(ctx, ipcMain, { sender: webContentsSender(mainWindow) })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
