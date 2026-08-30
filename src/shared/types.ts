/**
 * Shared types between main, preload, and renderer processes.
 */
export const APP_TITLE = 'SEU Summary'

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface PingResult {
  ok: boolean
  pong: string
}
