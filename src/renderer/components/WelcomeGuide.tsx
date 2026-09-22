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
 * 批1 (plan 2026-09-22-wide-screen-blank-space): 'main' 变体在内容列里是**两张
 * 并排的卡**——引导三步 + 数据流向说明。第二张把 DISCLAIMER.md 第 4/7 条的用户
 * 最关心的两句（只发你自己配的服务商 / 没有开发者服务器不上报）搬到首屏，
 * 完整条款仍指向「设置 › 关于与声明」。文案逐字可核对，不新增承诺。
 */
export function WelcomeGuide({ onLogin, onOpenBili, onOpenSettings, busy = false, variant = 'sidebar' }: WelcomeGuideProps): JSX.Element {
  const guide = (
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
  if (variant !== 'main') return guide
  return (
    <div class="welcome-guide-pair">
      {guide}
      <EmptyState className="welcome-guide welcome-guide-main" title="数据流向">
        <p>音频、视频截图、转写文本与追问内容，只发送到你自己在设置里配置的 ASR / LLM 服务商；不发给本软件开发者，也不发给学校。</p>
        <p>本软件没有开发者自有服务器，不上报任何数据给开发者；课程、任务与笔记只存在这台电脑的资料库里。</p>
        <p class="welcome-guide-note">完整条款见「设置 › 关于与声明」。</p>
      </EmptyState>
    </div>
  )
}
