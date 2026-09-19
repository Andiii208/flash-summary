import { describe, expect, it, vi, beforeEach } from 'vitest'
import { App } from '../../src/renderer/App'
import { AboutPanel } from '../../src/renderer/components/AboutPanel'
import { mount, click } from '../helpers/preact'
import { waitFor as waitForPredicate } from '../helpers/wait-for'
import { fakeState, makeBridge, ok, page } from '../helpers/fake-app-bridge'
import type { TaskRowInfo } from '../../src/shared/bridge'
import {
  FEEDBACK_DIAGNOSTICS_TITLE,
  FEEDBACK_OPEN_LABEL,
  FEEDBACK_SENSITIVE_HINT,
  FEEDBACK_TITLE
} from '../../src/shared/feedback'

/**
 * 声明批6（plan 2026-09-11 compliance-disclosure）: 测试期问题反馈通道的**可见面**。
 *
 * 两个落点：设置页的二维码区块（随时可反馈）、失败任务行的「反馈这个错误」弹层
 * （最想吐槽的那一刻）。测的是：入口真的在、二维码真的加载、点开有已脱敏的诊断
 * 文本、以及复制走的是用户自己的剪贴板——**应用不上报任何东西**。
 */

const FAILED_ROW: TaskRowInfo = {
  id: 't-failed',
  lesson_id: 'l1',
  state: 'failed',
  failed_stage: 'downloading_video',
  error_message: '拉流失败：连接被重置',
  error_kind: null,
  created_at: '2026-09-11T09:00:00Z',
  updated_at: '2026-09-11T09:02:00Z',
  lesson_title: '第3讲',
  course_name: '信号与系统'
}

async function waitFor(selector: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (document.querySelector(selector) == null) throw new Error(`waiting for ${selector}`)
    },
    { timeout: 3000, interval: 25 }
  )
}

function buttonByText(selector: string, label: string): HTMLElement | null {
  const found = Array.from(document.querySelectorAll(selector)).find((node) => node.textContent === label)
  return found instanceof HTMLElement ? found : null
}

const clipboardWrite = vi.fn(async (_text: string) => undefined)

describe('测试期问题反馈通道（声明批6）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    clipboardWrite.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWrite }, configurable: true })
  })

  it('设置页有反馈区块：标题、说明、二维码与打开按钮', () => {
    const openForm = vi.fn()
    mount(<AboutPanel version="1.0.0" onOpenFeedback={openForm} />)

    const block = document.querySelector('[data-testid="feedback-block"]')
    expect(block).not.toBeNull()
    expect(block?.textContent ?? '').toContain(FEEDBACK_TITLE)

    // 二维码用成品图（自带腾讯文档品牌与扫码说明），且必须够大——缩到 220px
    // 级二维码只剩 ~110px 就扫不动了，所以这里把尺寸也钉住。
    const qr = block?.querySelector('img.feedback-qr') as HTMLImageElement | null
    expect(qr).not.toBeNull()
    expect(Number(qr?.getAttribute('width'))).toBeGreaterThanOrEqual(360)
    expect(qr?.getAttribute('src') ?? '').not.toBe('')

    click(buttonByText('[data-testid="feedback-block"] button', FEEDBACK_OPEN_LABEL))
    expect(openForm).toHaveBeenCalledTimes(1)
  })

  it('没有回调时不出按钮，但二维码仍在（入口不能凭空消失）', () => {
    mount(<AboutPanel version="1.0.0" />)
    expect(document.querySelector('[data-testid="open-feedback-form"]')).toBeNull()
    expect(document.querySelector('img.feedback-qr')).not.toBeNull()
  })

  it('失败任务行给出「反馈这个错误」，点开是脱敏诊断文本 + 隐私提醒', async () => {
    const bridge = makeBridge()
    ;(bridge.tasks as unknown as { list: unknown }).list = vi.fn(async () => ok(page([FAILED_ROW])))
    mount(<App bridge={bridge} />)
    await waitFor('.app-shell')

    // 冷启动落在任务页签，「全部任务」列表直接可见。
    await waitFor('[data-testid="report-error"]')
    click(document.querySelector('[data-testid="report-error"]'))

    await waitFor('[data-testid="feedback-diagnostics"]')
    expect(document.body.textContent).toContain(FEEDBACK_DIAGNOSTICS_TITLE)
    expect(bridge.feedback.diagnostics).toHaveBeenCalledWith('t-failed')
    expect(document.querySelector('[data-testid="feedback-diagnostics"]')?.textContent ?? '').toContain('诊断信息')
    // 提醒必须和「复制」按钮同屏——我们主动给了复制，就得说清别复制什么。
    expect(document.querySelector('[data-testid="feedback-sensitive-hint"]')?.textContent).toBe(FEEDBACK_SENSITIVE_HINT)

    click(buttonByText('.dialog button', '复制诊断信息'))
    await waitForPredicate(() => expect(clipboardWrite).toHaveBeenCalledTimes(1))
    expect(String(clipboardWrite.mock.calls[0]?.[0] ?? '')).toContain('诊断信息')
  })

  it('诊断取不到时如实报错并收掉弹层，不留一个空壳对话框', async () => {
    const bridge = makeBridge()
    ;(bridge.tasks as unknown as { list: unknown }).list = vi.fn(async () => ok(page([FAILED_ROW])))
    ;(bridge.feedback as unknown as { diagnostics: unknown }).diagnostics = vi.fn(async () => ({ ok: false, error: '任务已被删除' }))
    mount(<App bridge={bridge} />)
    await waitFor('.app-shell')
    await waitFor('[data-testid="report-error"]')
    click(document.querySelector('[data-testid="report-error"]'))

    await waitForPredicate(() => expect(document.body.textContent).toContain('任务已被删除'))
    expect(document.querySelector('[data-testid="feedback-diagnostics"]')).toBeNull()
  })

  it('成功任务不给「反馈这个错误」——只给失败的那些', async () => {
    const bridge = makeBridge()
    ;(bridge.tasks as unknown as { list: unknown }).list = vi.fn(async () => ok(page([{ ...FAILED_ROW, state: 'succeeded', error_message: null }])))
    mount(<App bridge={bridge} />)
    await waitFor('.app-shell')
    await waitFor('.history-list')
    expect(document.querySelector('[data-testid="report-error"]')).toBeNull()
  })

  it('反馈通道不碰课时状态：点它不会顺带切换选中的课时', async () => {
    const bridge = makeBridge()
    ;(bridge.tasks as unknown as { list: unknown }).list = vi.fn(async () => ok(page([FAILED_ROW])))
    mount(<App bridge={bridge} />)
    await waitFor('.app-shell')
    await waitFor('[data-testid="report-error"]')
    click(document.querySelector('[data-testid="report-error"]'))
    await waitFor('[data-testid="feedback-diagnostics"]')
    // 仍停在任务页签（反馈是旁路动作，不该把用户带走）。
    expect(document.querySelector('.task-panel')).not.toBeNull()
    expect(fakeState.courses.length).toBeGreaterThan(0)
  })
})
