import type { JSX } from 'preact'
import { Colonnade } from '../ui/Colonnade'

export interface WelcomeGuideProps {
  onLogin: () => void
  /** 批1 双源并列: B站 is an equal first step, not a sidebar footnote. */
  onOpenBili: () => void
  onOpenSettings: () => void
  /** True while a login is in flight; disables the login action. */
  busy?: boolean
}

/** First-run onboarding: two parallel content sources, then providers, then notes. */
export function WelcomeGuide({ onLogin, onOpenBili, onOpenSettings, busy = false }: WelcomeGuideProps): JSX.Element {
  return (
    <div class="welcome-guide">
      <div class="empty-mark" aria-hidden="true">
        <Colonnade size={34} />
      </div>
      <h2>开始使用</h2>
      <ol class="guide-steps">
        <li>获取课程视频（东大云课堂 / B站）</li>
        <li>配置 Provider（模型能力）</li>
        <li>选择课程或导入视频，生成笔记</li>
      </ol>
      <div class="guide-actions">
        <button class="btn primary" onClick={onLogin} disabled={busy}>
          {busy ? '登录中…' : '登录东大云课堂'}
        </button>
        <button class="btn" onClick={onOpenBili}>
          导入 B站视频
        </button>
        <button class="btn" onClick={onOpenSettings}>
          去配置 Provider
        </button>
      </div>
    </div>
  )
}
