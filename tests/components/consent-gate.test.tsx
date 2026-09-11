import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act } from 'preact/test-utils'
import { App } from '../../src/renderer/App'
import { mount, click } from '../helpers/preact'
import { fakeState, makeBridge } from '../helpers/fake-app-bridge'
import {
  DISCLAIMER_CONSENT_CLAUSES,
  DISCLAIMER_CONSENT_CONFIRM_LABEL,
  DISCLAIMER_CONSENT_EXIT_LABEL,
  DISCLAIMER_TITLE
} from '../../src/shared/disclaimer'

/**
 * 声明批2（plan 2026-09-11 compliance-disclosure）: 首启「使用须知与免责声明」闸门。
 *
 * 测的是**机制**而不是文案：闸门拦不拦得住、同意是否真的落库、有没有偷偷留
 * 后门（Esc 关掉 / 回车误触退出 / 设置读失败直接放行）。文案随便改字不该让这里红。
 */

const CLAUSES = '[data-testid="consent-clauses"]'
const BOOT = '[data-testid="consent-boot"]'
const SHELL = '.app-shell'

async function waitFor(selector: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (document.querySelector(selector) == null) throw new Error(`waiting for ${selector}`)
    },
    { timeout: 3000, interval: 25 }
  )
}

/** A dialog action button by its visible label. */
function actionButton(label: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll('.dialog-actions button')) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent === label) ?? null
}

/** Tick the consent checkbox the way a user would. */
function tickCheckbox(checked: boolean): void {
  const box = document.querySelector('.dialog-check input') as HTMLInputElement | null
  act(() => {
    if (box == null) return
    box.checked = checked
    box.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const closeSpy = vi.fn()

describe('首启使用须知闸门', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    closeSpy.mockClear()
    // happy-dom's window.close is a no-op we need to observe.
    Object.defineProperty(window, 'close', { value: closeSpy, writable: true, configurable: true })
  })

  it('未接受时不渲染主界面，只显示闸门与九条', async () => {
    const bridge = makeBridge()
    fakeState.disclaimerAccepted = false
    mount(<App bridge={bridge} />)

    await waitFor(CLAUSES)
    expect(document.body.textContent).toContain(DISCLAIMER_TITLE)
    // 九条精简版必须都在——少一条就是少告知一件事。
    for (const clause of DISCLAIMER_CONSENT_CLAUSES) {
      expect(document.body.textContent, clause.heading).toContain(clause.text)
    }
    // 主界面绝不能已经渲染出来（那等于闸门形同虚设）。
    expect(document.querySelector(SHELL)).toBeNull()
  })

  it('未勾选时「同意并继续」是禁用的，勾选后才可点', async () => {
    const bridge = makeBridge()
    fakeState.disclaimerAccepted = false
    mount(<App bridge={bridge} />)
    await waitFor(CLAUSES)

    const confirm = actionButton(DISCLAIMER_CONSENT_CONFIRM_LABEL)
    expect(confirm).not.toBeNull()
    expect(confirm?.disabled).toBe(true)
    // 未勾选时点它不能产生任何副作用。
    click(confirm)
    expect(bridge.settings.acceptDisclaimer).not.toHaveBeenCalled()

    tickCheckbox(true)
    expect(actionButton(DISCLAIMER_CONSENT_CONFIRM_LABEL)?.disabled).toBe(false)
  })

  it('勾选并同意后落库，闸门消失、主界面出现', async () => {
    const bridge = makeBridge()
    fakeState.disclaimerAccepted = false
    mount(<App bridge={bridge} />)
    await waitFor(CLAUSES)

    tickCheckbox(true)
    click(actionButton(DISCLAIMER_CONSENT_CONFIRM_LABEL))

    await waitFor(SHELL)
    expect(bridge.settings.acceptDisclaimer).toHaveBeenCalledTimes(1)
    expect(document.querySelector(CLAUSES)).toBeNull()
    // 闸门自己只是 UI；状态由 main 侧落库后再回读确认（见下一批的 IPC 测试）。
    expect(fakeState.disclaimerAccepted).toBe(true)
  })

  it('Esc 关不掉闸门（persistent）', async () => {
    const bridge = makeBridge()
    fakeState.disclaimerAccepted = false
    mount(<App bridge={bridge} />)
    await waitFor(CLAUSES)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.querySelector(CLAUSES)).not.toBeNull()
    expect(document.querySelector(SHELL)).toBeNull()
  })

  it('焦点不落在「退出应用」上——避免回车误退', async () => {
    const bridge = makeBridge()
    fakeState.disclaimerAccepted = false
    mount(<App bridge={bridge} />)
    await waitFor(CLAUSES)

    const exit = actionButton(DISCLAIMER_CONSENT_EXIT_LABEL)
    expect(exit).not.toBeNull()
    // 取消键在普通确认框里 autoFocus（防连按回车误确认）；闸门必须反过来。
    expect(document.activeElement).not.toBe(exit)
  })

  it('「退出应用」走真实关闭路径，不是「稍后再说」', async () => {
    const bridge = makeBridge()
    fakeState.disclaimerAccepted = false
    mount(<App bridge={bridge} />)
    await waitFor(CLAUSES)

    click(actionButton(DISCLAIMER_CONSENT_EXIT_LABEL))
    expect(closeSpy).toHaveBeenCalledTimes(1)
    // 退出不等于同意：什么都没写库。
    expect(bridge.settings.acceptDisclaimer).not.toHaveBeenCalled()
  })

  it('设置还在读时不放行，也不误报闸门（boot 态）', async () => {
    const bridge = makeBridge()
    fakeState.settingsPending = true
    mount(<App bridge={bridge} />)

    await waitFor(BOOT)
    expect(document.querySelector(CLAUSES)).toBeNull()
    expect(document.querySelector(SHELL)).toBeNull()
    expect(document.body.textContent).toContain('正在加载设置')
  })

  it('设置读取失败时给出如实错误与重试，而不是静默放行', async () => {
    const bridge = makeBridge()
    fakeState.settingsError = '数据库已损坏'
    mount(<App bridge={bridge} />)

    await waitFor(BOOT)
    expect(document.body.textContent).toContain('数据库已损坏')
    expect(document.querySelector(SHELL)).toBeNull()

    // 重试按钮重新拉取；这次让它成功，主界面才出现。
    fakeState.settingsError = null
    click(Array.from(document.querySelectorAll('.consent-boot button')).find((b) => b.textContent === '重试') ?? null)
    await waitFor(SHELL)
    expect((bridge.settings.get as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1)
  })

  it('同意写入失败时不放行（不能拿一个没落库的同意蒙混过关）', async () => {
    const bridge = makeBridge()
    fakeState.disclaimerAccepted = false
    ;(bridge.settings as unknown as { acceptDisclaimer: unknown }).acceptDisclaimer = vi.fn(async () => ({ ok: false, error: '写盘失败' }))
    mount(<App bridge={bridge} />)
    await waitFor(CLAUSES)

    tickCheckbox(true)
    click(actionButton(DISCLAIMER_CONSENT_CONFIRM_LABEL))

    // Give the async accept a chance to settle, then assert the gate held.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(document.querySelector(SHELL)).toBeNull()
    expect(document.querySelector(CLAUSES)).not.toBeNull()
  })
})
