import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, PingResult } from '../shared/types'

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  ping: (message: string): Promise<PingResult> => ipcRenderer.invoke('app:ping', message)
}

export type SeuSummaryApi = typeof api

contextBridge.exposeInMainWorld('seuSummary', api)
