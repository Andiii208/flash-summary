/**
 * 指向 GitHub Releases 的更新检查（plan docs/plans/2026-09-30-public-release-autoupdate.md）。
 *
 * 形态是**用户手动触发**：没有后台检查、没有定时任务——用户不点「检查更新」，
 * 这里不会发生任何网络请求（与「不上报任何数据」红线同一口径：更新请求只发往
 * GitHub Releases，读版本与安装包信息，不携带使用数据）。
 *
 * 本模块是纯逻辑 + 依赖注入：**不 import electron / electron-updater**。真实装配
 * 只发生在 src/main/index.ts（注入 app 与 autoUpdater）；测试注入假的。
 * feed 来源钉死在 UPDATE_FEED 常量——渲染层传任何参数都无法改变更新源
 * （与 settings:openAuthor 同一条红线：不接受调用方给的 URL）。
 */
import type { UpdateCheckInfo, UpdateEvent } from '../shared/bridge'

/** 更新源唯一事实源：只认本项目的 GitHub Releases。 */
export const UPDATE_FEED = { provider: 'github', owner: 'Andiii208', repo: 'flash-summary' } as const

/** autoUpdater 的注入面：只要这几个成员，测试给假的即可。 */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  on(channel: 'download-progress' | 'update-downloaded' | 'error', listener: (info: unknown) => void): void
}

/** app 的注入面（isPackaged 决定开发模式下根本不检查）。 */
export interface UpdateAppLike {
  isPackaged: boolean
}

export interface UpdateController {
  check(): Promise<UpdateCheckInfo>
  download(): Promise<{ started: boolean }>
  install(): Promise<{ installed: boolean }>
  subscribe(cb: (event: UpdateEvent) => void): () => void
}

function messageOf(e: unknown): string {
  return e instanceof Error && e.message !== '' ? e.message : String(e)
}

function percentOf(info: unknown): number {
  const percent = (info as { percent?: number } | null)?.percent
  return typeof percent === 'number' && Number.isFinite(percent) ? Math.round(percent) : 0
}

function versionOf(info: unknown): string {
  const version = (info as { version?: string } | null)?.version
  return typeof version === 'string' ? version : ''
}

export function createUpdateController(deps: { app: UpdateAppLike; updater: AutoUpdaterLike }): UpdateController {
  const listeners = new Set<(event: UpdateEvent) => void>()
  const emit = (event: UpdateEvent): void => {
    for (const listener of listeners) listener(event)
  }
  let downloading = false

  // 下载必须经用户确认（设置页弹层）；但点「稍后」后下次退出要能装上。
  deps.updater.autoDownload = false
  deps.updater.autoInstallOnAppQuit = true
  deps.updater.on('download-progress', (info) => emit({ type: 'progress', percent: percentOf(info) }))
  deps.updater.on('update-downloaded', (info) => {
    downloading = false
    emit({ type: 'downloaded', version: versionOf(info) })
  })
  deps.updater.on('error', (err) => {
    downloading = false
    emit({ type: 'error', message: messageOf(err) })
  })

  const check = async (): Promise<UpdateCheckInfo> => {
    if (!deps.app.isPackaged) return { status: 'unsupported', message: '开发模式下不检查更新' }
    try {
      const result = await deps.updater.checkForUpdates()
      if (result == null) return { status: 'up-to-date' }
      return { status: 'available', version: result.updateInfo.version }
    } catch (e) {
      return { status: 'error', message: messageOf(e) }
    }
  }

  const download = async (): Promise<{ started: boolean }> => {
    if (downloading) return { started: false }
    downloading = true
    try {
      await deps.updater.downloadUpdate()
      return { started: true }
    } catch (e) {
      downloading = false
      emit({ type: 'error', message: messageOf(e) })
      return { started: false }
    }
  }

  return {
    check,
    download,
    install: async () => {
      deps.updater.quitAndInstall()
      return { installed: true }
    },
    subscribe: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    }
  }
}
