import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { SessionStateValue } from '../../shared/types'
import { Colonnade } from '../ui/Colonnade'
import { Dialog } from '../ui/Dialog'

export type SessionState = SessionStateValue

export interface TopBarProps {
  session: SessionState
  /** B站 session for the parallel source badge (null = not read yet). */
  biliSession: 'logged_in' | 'logged_out' | null
  busy: boolean
  /** A task is currently executing (serial queue) — show the live dot. */
  running: boolean
  onLogin: () => void
  onLogout: () => void
  /** 批1 双源并列: open the B站 import dialog (login + import live there). */
  onOpenBili: () => void
  /** 批A: brand click = back to the start view (no lesson picked, tasks tab). */
  onHome: () => void
  /** 批A: «you are here» breadcrumb — present only while a lesson is picked. */
  breadcrumb: { courseName: string; lessonTitle: string } | null
  /** 批A: clicking the course crumb clears the lesson selection. */
  onClearLesson: () => void
}

const SESSION_LABELS: Record<SessionState, string> = {
  logged_in: '东大·已登录',
  expired: '东大·已过期',
  logged_out: '东大·未登录'
}

const SESSION_TITLES: Record<SessionState, string> = {
  logged_in: '东大云课堂已登录，点击退出登录',
  expired: '会话已过期，点击重新登录',
  logged_out: '点击登录东大云课堂（CAS）'
}

/**
 * 批1 双源并列（plan 2026-09-07）：两个内容源的会话徽标并列常驻——东大与
 * B站同构同级，点击即操作（登录/退出/打开导入），不再是单一 CAS 按钮加
 * 沉底的 B站小面板。
 */
export function TopBar({ session, biliSession, busy, running, onLogin, onLogout, onOpenBili, onHome, breadcrumb, onClearLesson }: TopBarProps): JSX.Element {
  // C4: logout wipes the working context — confirm first.
  const [pendingLogout, setPendingLogout] = useState(false)
  const biliLoggedIn = biliSession === 'logged_in'
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
        <button
          class={`session-badge ${session}`}
          data-testid="session-badge"
          title={SESSION_TITLES[session]}
          onClick={() => {
            if (session === 'logged_in') setPendingLogout(true)
            else onLogin()
          }}
          disabled={busy}
        >
          <span class="badge-dot" />
          {SESSION_LABELS[session]}
        </button>
        <button
          class={`session-badge bili ${biliLoggedIn ? 'logged_in' : 'logged_out'}`}
          data-testid="bili-session-badge"
          title={biliLoggedIn ? 'B站已登录，点击导入视频' : '点击登录B站并导入视频'}
          onClick={onOpenBili}
        >
          <span class="badge-dot" />
          {biliLoggedIn ? 'B站·已登录' : 'B站·未登录'}
        </button>
      </div>
      <Dialog
        open={pendingLogout}
        title="退出东大云课堂登录？"
        message="将清除本机保存的学校会话；课程收藏与已生成的笔记保留，重新登录后即可继续。B站登录不受影响。"
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
