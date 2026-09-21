import { describe, expect, it } from 'vitest'
import { mount } from '../helpers/preact'
import { ProviderPanel } from '../../src/renderer/components/ProviderPanel'
import { SettingsPanel } from '../../src/renderer/components/SettingsPanel'
import { TopBar, OWN_ACCOUNT_HINT } from '../../src/renderer/components/TopBar'

/**
 * 声明批5（plan 2026-09-11 compliance-disclosure）: 场景化的一行说明。
 *
 * 这一批不加机制，只把话说在**用户正在做那个决定的位置**：
 *  · Provider 配置区 → 数据发给谁、留存归谁管（用户正在挑服务商）；
 *  · 账号块与两个徽标 → 用本人账号、平台可能有风控（用户正在登录/切换账号）。
 * 测的是「这些位置确实有话说」，不是具体字句。
 */

const settingsBaseProps = {
  session: 'logged_out' as const,
  sessionInfo: { savedAt: null, expiresAt: null },
  sessionBusy: false,
  onLogin: () => undefined,
  onLogout: () => undefined,
  providers: null,
  providerBusy: false,
  onSaveProvider: async () => true,
  onRemoveProvider: () => undefined,
  onSetCacheDir: () => undefined,
  onSetTheme: () => undefined,
  onChooseLibrary: () => undefined,
  onOpenPath: () => undefined
}

const topBarProps = {
  session: 'logged_out' as const,
  biliSession: 'logged_out' as const,
  busy: false,
  running: false,
  onLogin: () => undefined,
  onLogout: () => undefined,
  onOpenBili: () => undefined,
  onOpenTasks: () => undefined,
  onHome: () => undefined,
  breadcrumb: null,
  onClearLesson: () => undefined
}

describe('声明批5 — 说在用户做决定的位置', () => {
  it('Provider 配置区常驻数据流向说明，且不含法律术语', () => {
    mount(<ProviderPanel providers={null} busy={false} onSave={async () => true} onRemove={() => undefined} />)
    const note = document.querySelector('[data-testid="provider-disclosure"]')
    expect(note).not.toBeNull()
    const text = note?.textContent ?? ''
    // 必须说清三件事：发什么、发给谁、留存归谁管——外加没有开发者服务器。
    expect(text).toContain('音频、视频截图和文本')
    expect(text).toContain('你填写的服务商')
    expect(text).toContain('以它的条款为准')
    expect(text).toContain('没有开发者服务器')
    // D7 裁决：应用不知道用户填的是境内还是境外服务商，不提跨境/出境。
    for (const word of ['跨境', '出境', '不可抗力']) {
      expect(text).not.toContain(word)
    }
  })

  it('账号块给出账号风险说明（与徽标提示同源）', () => {
    mount(<SettingsPanel {...settingsBaseProps} settings={null} />)
    const note = document.querySelector('[data-testid="account-risk-note"]')
    expect(note).not.toBeNull()
    expect(note?.textContent ?? '').toContain(OWN_ACCOUNT_HINT)
    expect(note?.textContent ?? '').toContain('学校')
  })

  it('两个会话徽标的 hover 提示都带上「用本人账号」', () => {
    mount(<TopBar {...topBarProps} />)
    const cas = document.querySelector('[data-testid="session-badge"]')
    const bili = document.querySelector('[data-testid="bili-session-badge"]')
    expect(cas?.getAttribute('title') ?? '').toContain(OWN_ACCOUNT_HINT)
    expect(bili?.getAttribute('title') ?? '').toContain(OWN_ACCOUNT_HINT)
  })

  it('提示本身不吓人：只陈述事实，不用法律术语', () => {
    for (const word of ['跨境', '出境', '不可抗力', '免责声明全文']) {
      expect(OWN_ACCOUNT_HINT).not.toContain(word)
    }
    expect(OWN_ACCOUNT_HINT).toContain('你本人的账号')
  })
})
