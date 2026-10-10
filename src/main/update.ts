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

/**
 * 检查失败的用户可读文案（2026-10-01，plan 2026-10-01-note-inline-images-and-updater-feed）：
 * 上游原始 message 形如 `Cannot find latest.yml ... (url): HttpError: 404 ... at createHttpError`，
 * 含内部 URL 与打包堆栈——只经 onFailure 进日志，渲染层一律只收这里的短句。
 * ERR_UPDATER_CHANNEL_FILE_NOT_FOUND = feed 渠道文件（latest.yml）不在 release 资产里
 * （electron-updater GitHubProvider 在 404 时抛的 code，比解析 message 文本稳）。
 */
function checkFailureMessage(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
    return '暂时无法检查更新：发布渠道信息缺失，请稍后重试或前往本项目 GitHub 发布页查看。'
  }
  return '暂时无法检查更新：网络或发布服务器无响应，请稍后重试。'
}

/**
 * 下载失败的用户可读文案（2026-10-10，plan 2026-10-10-updater-feed-fix-and-release-pipeline）：
 * 下载这条路径此前的 catch 把原始 message 原样 emit 到设置页——404 时会印出含内部 URL
 * 与打包堆栈的一长串英文（与 v0.7.13 检查路径同款缺陷，当时只修了 check 漏了 download）。
 * 现在统一口径：UI 只收一句人话，原始详情只走 onFailure 进日志。
 */
function downloadFailureMessage(): string {
  return '暂时无法下载更新：网络或发布服务器无响应，请稍后重试或前往本项目 GitHub 发布页手动下载。'
}

function percentOf(info: unknown): number {
  const percent = (info as { percent?: number } | null)?.percent
  return typeof percent === 'number' && Number.isFinite(percent) ? Math.round(percent) : 0
}

function versionOf(info: unknown): string {
  const version = (info as { version?: string } | null)?.version
  return typeof version === 'string' ? version : ''
}

export function createUpdateController(deps: {
  app: UpdateAppLike
  updater: AutoUpdaterLike
  /** 原始失败详情的落点（日志）；UI 只收脱敏短句。不传则详情无处可查——装配处应传。 */
  onFailure?: (raw: string) => void
}): UpdateController {
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
    // 2026-10-10：'error' 是 electron-updater 下载/安装阶段的异步错误通道——
    // downloadUpdate() 拒绝前会先 dispatchError（AppUpdater.js errorHandler），
    // 只脱敏 catch 会被这条路径绕过（404 的 HttpError 含内部 URL 与堆栈）。
    // 与 download() catch 同一把尺：原始详情进日志，UI 收脱敏短句。
    deps.onFailure?.(messageOf(err))
    emit({ type: 'error', message: downloadFailureMessage() })
  })

  const check = async (): Promise<UpdateCheckInfo> => {
    if (!deps.app.isPackaged) return { status: 'unsupported', message: '开发模式下不检查更新' }
    try {
      const result = await deps.updater.checkForUpdates()
      if (result == null) return { status: 'up-to-date' }
      return { status: 'available', version: result.updateInfo.version }
    } catch (e) {
      // 2026-10-01：v0.7.13 上线时 feed 缺 latest.yml，原始 message（含 URL 与打包
      // 堆栈）被原样印在设置页。现在原始详情只走 onFailure 进日志。
      deps.onFailure?.(messageOf(e))
      return { status: 'error', message: checkFailureMessage(e) }
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
      // 2026-10-10：与 check 同一把尺——原始 message 只进日志，UI 收脱敏短句。
      deps.onFailure?.(messageOf(e))
      emit({ type: 'error', message: downloadFailureMessage() })
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
