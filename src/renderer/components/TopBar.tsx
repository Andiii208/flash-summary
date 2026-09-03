import type { JSX } from 'preact'
import type { SessionStateValue } from '../../shared/types'

export type SessionState = SessionStateValue

export interface TopBarProps {
  session: SessionState
  busy: boolean
  /** A task is currently executing (serial queue) — show the live dot. */
  running: boolean
  onLogin: () => void
  onLogout: () => void
}

const SESSION_LABELS: Record<SessionState, string> = {
  logged_in: '已登录',
  expired: '已过期',
  logged_out: '未登录'
}

export function TopBar({ session, busy, running, onLogin, onLogout }: TopBarProps): JSX.Element {
  return (
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">S</span>
        <h1>SEU Summary</h1>
      </div>
      <div class="topbar-right">
        {running && (
          <span class="running-pill" data-testid="running-pill" title="串行队列中有任务正在执行">
            <span class="pulse-dot" />
            任务运行中
          </span>
        )}
        <span class={`session-badge ${session}`} data-testid="session-badge">
          <span class="badge-dot" />
          {SESSION_LABELS[session]}
        </span>
        {session === 'logged_in' ? (
          <button class="btn" onClick={onLogout} disabled={busy}>
            退出登录
          </button>
        ) : (
          <button class="btn primary" onClick={onLogin} disabled={busy}>
            {busy ? '登录中…' : session === 'expired' ? '重新登录' : '登录 CAS'}
          </button>
        )}
      </div>
    </header>
  )
}
