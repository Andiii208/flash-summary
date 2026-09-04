import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { SessionStateValue } from '../../shared/types'
import { Colonnade } from '../ui/Colonnade'
import { Dialog } from '../ui/Dialog'

export type SessionState = SessionStateValue

export interface TopBarProps {
  session: SessionState
  busy: boolean
  /** A task is currently executing (serial queue) — show the live dot. */
  running: boolean
  onLogin: () => void
  onLogout: () => void
  /** 批A: brand click = back to the start view (no lesson picked, tasks tab). */
  onHome: () => void
  /** 批A: «you are here» breadcrumb — present only while a lesson is picked. */
  breadcrumb: { courseName: string; lessonTitle: string } | null
  /** 批A: clicking the course crumb clears the lesson selection. */
  onClearLesson: () => void
}

const SESSION_LABELS: Record<SessionState, string> = {
  logged_in: '已登录',
  expired: '已过期',
  logged_out: '未登录'
}

export function TopBar({ session, busy, running, onLogin, onLogout, onHome, breadcrumb, onClearLesson }: TopBarProps): JSX.Element {
  // C4: logout wipes the working context — confirm first.
  const [pendingLogout, setPendingLogout] = useState(false)
  return (
    <header class="topbar">
      <div class="topbar-left">
        <button class="brand" onClick={onHome} title="回到起始页">
          <span class="brand-mark" aria-hidden="true">
            <Colonnade size={17} />
          </span>
          <h1>SEU Summary</h1>
        </button>
        {breadcrumb != null && (
          <nav class="crumbs" aria-label="当前位置">
            <button class="crumb" onClick={onClearLesson} title="回到全部课程">
              {breadcrumb.courseName}
            </button>
            <span class="crumb-sep" aria-hidden="true">
              /
            </span>
            <span class="crumb-current">{breadcrumb.lessonTitle}</span>
          </nav>
        )}
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
          <button class="btn" onClick={() => setPendingLogout(true)} disabled={busy}>
            退出登录
          </button>
        ) : (
          <button class="btn primary" onClick={onLogin} disabled={busy}>
            {busy ? '登录中…' : session === 'expired' ? '重新登录' : '登录 CAS'}
          </button>
        )}
      </div>
      <Dialog
        open={pendingLogout}
        title="退出登录？"
        message="将清除本机保存的学校会话；课程收藏与已生成的笔记保留，重新登录后即可继续。"
        confirmLabel="退出"
        danger
        onConfirm={() => {
          setPendingLogout(false)
          onLogout()
        }}
        onCancel={() => setPendingLogout(false)}
      />
    </header>
  )
}
