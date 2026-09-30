import type { JSX } from 'preact'
import { Dialog } from '../ui/Dialog'

/** 2026-09-30 (plan 2026-09-30-public-release-autoupdate): 更新检查的状态机。 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'failed'
  | 'unsupported'

export interface UpdatePanelState {
  phase: UpdatePhase
  /** 可安装的新版本号（available / downloading / downloaded 时在）。 */
  version?: string
  /** downloading 时的进度百分比。 */
  percent?: number
  /** unsupported / failed 时的人话原因。 */
  message?: string
  /** 已下载完成但还没安装的版本号——「稍后」后仍保留，供状态行与安装按钮。 */
  downloaded?: string
}

export interface UpdatePanelProps {
  /** 当前安装版本（「已是最新版本」行要用）。 */
  version?: string
  state: UpdatePanelState
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
  onDismiss: () => void
}

function statusLine(current: string | undefined, state: UpdatePanelState): string {
  switch (state.phase) {
    case 'checking':
      return '正在检查更新…'
    case 'up-to-date':
      return `已是最新版本${current != null ? `（v${current}）` : ''}。`
    case 'available':
      return `发现新版本 v${state.version ?? ''}。`
    case 'downloading':
      return `正在下载更新… ${state.percent ?? 0}%`
    case 'downloaded':
      return '更新包已下载完成，等待重启安装。'
    case 'failed':
      return state.message ?? '检查更新失败，请稍后重试。'
    case 'unsupported':
      return state.message ?? '当前构建不支持检查更新。'
    default:
      return state.downloaded != null
        ? `更新包已下载（v${state.downloaded}），重启应用即完成安装。`
        : '更新从 GitHub Releases 检查与下载；安装包未签名，Windows 可能提示 SmartScreen。'
  }
}

/** 两个决策弹层都是共享 ui/Dialog（滚动锁 / Esc 只关最上层）。 */
function updateDialogs(props: UpdatePanelProps): JSX.Element {
  return (
    <>
      <Dialog
        open={props.state.phase === 'available'}
        title={props.state.version != null ? `发现新版本 v${props.state.version}` : '发现新版本'}
        message="现在下载并安装吗？下载过程会显示进度，完成后需要重启应用完成更新。"
        confirmLabel="下载并安装"
        cancelLabel="稍后"
        onConfirm={props.onDownload}
        onCancel={props.onDismiss}
      />
      <Dialog
        open={props.state.phase === 'downloaded'}
        title="新版本已下载完成"
        message="重启应用后自动完成安装；选择「稍后」，更新包会在下次退出应用时自动安装。"
        confirmLabel="立即重启安装"
        cancelLabel="稍后"
        onConfirm={props.onInstall}
        onCancel={props.onDismiss}
      />
    </>
  )
}

/**
 * 设置页「关于与声明」里的更新区块。busy 纪律与其它慢操作按钮一致：
 * 文案加省略号 + disabled；在跑守卫由调用方（config domain）的 phase 提供。
 * 「已下载未安装」态下主按钮变成「重启并安装」——对话框点过「稍后」也不丢路径。
 */
export function UpdatePanel(props: UpdatePanelProps): JSX.Element {
  const { state } = props
  const busy = state.phase === 'checking' || state.phase === 'downloading'
  const awaitingInstall = state.phase === 'idle' && state.downloaded != null
  const label = state.phase === 'checking'
    ? '检查中…'
    : state.phase === 'downloading'
      ? `下载中… ${state.percent ?? 0}%`
      : awaitingInstall
        ? '重启并安装'
        : '检查更新'
  return (
    <div class="update-block" data-testid="update-block">
      <div class="settings-row">
        <span class="settings-label">更新</span>
        <button class="btn small" onClick={awaitingInstall ? props.onInstall : props.onCheck} disabled={busy} data-testid="check-update">
          {label}
        </button>
      </div>
      <p class="about-note" data-testid="update-status">
        {statusLine(props.version, state)}
      </p>
      {updateDialogs(props)}
    </div>
  )
}
