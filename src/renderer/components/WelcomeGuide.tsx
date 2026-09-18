import type { JSX } from 'preact'
import { EmptyState } from './EmptyState'

export interface WelcomeGuideProps {
  onLogin: () => void
  /** 批1 双源并列: B站 is an equal first step, not a sidebar footnote. */
  onOpenBili: () => void
  onOpenSettings: () => void
  /** True while a login is in flight; disables the login action. */
  busy?: boolean
  /**
   * 批2（plan 2026-09-18 typography）: 同一份三步内容有两种落点。
   * 'sidebar' = 304px 侧栏里的紧凑卡（按钮整宽竖排）；'main' = 内容列里的首启卡
   * （零课程时主区承接引导——此前主区写「从左侧课程树点击一个课时」，而左侧一门课
   * 都没有，两处空态自相矛盾）。
   */
  variant?: 'sidebar' | 'main'
}

/**
 * First-run onboarding: two parallel content sources, then providers, then
 * notes. 批6 (plan 2026-09-07 v07): this used to be a near-duplicate card —
 * it is now an EmptyState variant (steps as children, three actions).
 */
export function WelcomeGuide({ onLogin, onOpenBili, onOpenSettings, busy = false, variant = 'sidebar' }: WelcomeGuideProps): JSX.Element {
  return (
    <EmptyState
      className={variant === 'main' ? 'welcome-guide welcome-guide-main' : 'welcome-guide'}
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
