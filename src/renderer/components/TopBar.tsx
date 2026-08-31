import type { JSX } from 'preact'

export type SessionState = 'logged_in' | 'logged_out'

export interface TopBarProps {
  session: SessionState
  busy: boolean
  onLogin: () => void
  onLogout: () => void
}

export function TopBar({ session, busy, onLogin, onLogout }: TopBarProps): JSX.Element {
  return (
    <header class="topbar">
      <h1>SEU Summary</h1>
      <div class="topbar-right">
        <span class={`session-badge ${session}`} data-testid="session-badge">
          {session === 'logged_in' ? '已登录' : '未登录'}
        </span>
        {session === 'logged_in' ? (
          <button class="btn" onClick={onLogout} disabled={busy}>
            退出登录
          </button>
        ) : (
          <button class="btn primary" onClick={onLogin} disabled={busy}>
            {busy ? '登录中…' : '登录 CAS'}
          </button>
        )}
      </div>
    </header>
  )
}
