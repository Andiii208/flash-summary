import type { JSX } from 'preact'
import { EmptyState } from './EmptyState'

export interface WelcomeGuideProps {
  onLogin: () => void
  /** 批1 双源并列: B站 is an equal first step, not a sidebar footnote. */
  onOpenBili: () => void
  onOpenSettings: () => void
  /** True while a login is in flight; disables the login action. */
  busy?: boolean
}

/**
 * First-run onboarding: two parallel content sources, then providers, then
 * notes. 批6 (plan 2026-09-07 v07): this used to be a near-duplicate card —
 * it is now an EmptyState variant (steps as children, three actions).
 */
export function WelcomeGuide({ onLogin, onOpenBili, onOpenSettings, busy = false }: WelcomeGuideProps): JSX.Element {
  return (
    <EmptyState
      className="welcome-guide"
      title="开始使用"
      actions={[
        { label: busy ? '登录中…' : '登录东大云课堂', onAction: onLogin, kind: 'primary', disabled: busy },
        { label: '导入 B站视频', onAction: onOpenBili },
        { label: '去配置 Provider', onAction: onOpenSettings }
      ]}
    >
      <ol class="guide-steps">
        <li>获取课程视频（东大云课堂 / B站）</li>
        <li>配置 Provider（模型能力）</li>
        <li>选择课程或导入视频，生成笔记</li>
      </ol>
    </EmptyState>
  )
}
