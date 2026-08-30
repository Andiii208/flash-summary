import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { APP_TITLE, type AppInfo, type PingResult } from '../shared/types'

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: APP_TITLE,
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

  return win
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:info', (): AppInfo => ({
    name: APP_TITLE,
    version: app.getVersion(),
    platform: process.platform
  }))

  ipcMain.handle('app:ping', (_event, message: unknown): PingResult => {
    const text = typeof message === 'string' ? message : ''
    return { ok: true, pong: `pong:${text}` }
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
