import type { JSX } from 'preact'

export interface WelcomeGuideProps {
  onLogin: () => void
  onOpenSettings: () => void
  /** True while a login is in flight; disables the login action. */
  busy?: boolean
}

/** First-run onboarding (U2 task 5): three steps, each with a jump target. */
export function WelcomeGuide({ onLogin, onOpenSettings, busy = false }: WelcomeGuideProps): JSX.Element {
  return (
    <div class="welcome-guide">
      <h2>开始使用</h2>
      <ol class="guide-steps">
        <li>登录 CAS</li>
        <li>配置 Provider（模型能力）</li>
        <li>选择课程生成笔记</li>
      </ol>
      <div class="guide-actions">
        <button class="btn primary" onClick={onLogin} disabled={busy}>
          {busy ? '登录中…' : '登录 CAS'}
        </button>
        <button class="btn" onClick={onOpenSettings}>
          去配置 Provider
        </button>
      </div>
    </div>
  )
}
