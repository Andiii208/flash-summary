import { describe, expect, it, vi } from 'vitest'
import { ToastArea } from '../../src/renderer/components/ToastArea'
import { ProgressBar } from '../../src/renderer/components/ProgressBar'
import { EmptyState } from '../../src/renderer/components/EmptyState'
import { WelcomeGuide } from '../../src/renderer/components/WelcomeGuide'
import { ProviderPanel } from '../../src/renderer/components/ProviderPanel'
import { TopBar } from '../../src/renderer/components/TopBar'
import { ManualAdd } from '../../src/renderer/components/ManualAdd'
import { mount, click, input } from '../helpers/preact'

describe('ToastArea', () => {
  it('renders toasts with their kind class', () => {
    const host = mount(<ToastArea toasts={[{ id: 1, message: '成功', kind: 'success' }, { id: 2, message: '出错', kind: 'error' }]} />)
    const toasts = host.querySelectorAll('.toast')
    expect(toasts).toHaveLength(2)
    expect(toasts[0]!.classList.contains('toast-success')).toBe(true)
    expect(toasts[1]!.classList.contains('toast-error')).toBe(true)
  })
})

describe('ProgressBar', () => {
  it('maps percent to width and aria values', () => {
    const host = mount(<ProgressBar percent={42} active />)
    const bar = host.querySelector<HTMLElement>('.progress-bar')
    expect(bar?.style.width).toBe('42%')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42')
    expect(host.querySelector('.progress.active')).not.toBeNull()
  })

  it('clamps percent out of range', () => {
    const host = mount(<ProgressBar percent={150} active={false} />)
    expect((host.querySelector<HTMLElement>('.progress-bar')?.style.width)).toBe('100%')
  })
})

describe('EmptyState', () => {
  it('renders title/hint and fires the action', () => {
    const onAction = vi.fn()
    const host = mount(<EmptyState title="空" hint="提示" actionLabel="去配置" onAction={onAction} />)
    expect(host.textContent).toContain('空')
    expect(host.textContent).toContain('提示')
    click(host.querySelector('button'))
    expect(onAction).toHaveBeenCalledOnce()
  })
})

describe('WelcomeGuide', () => {
  it('shows the three onboarding steps with jump actions', () => {
    const onLogin = vi.fn()
    const onSettings = vi.fn()
    const host = mount(<WelcomeGuide onLogin={onLogin} onOpenSettings={onSettings} />)
    const steps = host.querySelectorAll('.guide-steps li')
    expect(steps).toHaveLength(3)
    const buttons = host.querySelectorAll('button')
    click(buttons[0])
    expect(onLogin).toHaveBeenCalledOnce()
    click(buttons[1])
    expect(onSettings).toHaveBeenCalledOnce()
  })

  it('disables the login action while a login is in flight', () => {
    const onLogin = vi.fn()
    const host = mount(<WelcomeGuide onLogin={onLogin} onOpenSettings={() => undefined} busy />)
    const loginButton = host.querySelector<HTMLButtonElement>('.guide-actions button.primary')
    expect(loginButton?.disabled).toBe(true)
    expect(host.textContent).toContain('登录中…')
    click(loginButton)
    expect(onLogin).not.toHaveBeenCalled()
  })
})

describe('TopBar', () => {
  it('shows login when logged out and fires onLogin', () => {
    const onLogin = vi.fn()
    const host = mount(<TopBar session="logged_out" busy={false} running={false} onLogin={onLogin} onLogout={() => undefined} />)
    expect(host.textContent).toContain('登录 CAS')
    click(host.querySelector('button'))
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('shows logout when logged in with a session badge, behind a confirmation (批4 C4)', () => {
    const onLogout = vi.fn()
    const host = mount(<TopBar session="logged_in" busy={false} running={false} onLogin={() => undefined} onLogout={onLogout} />)
    expect(host.textContent).toContain('已登录')
    expect(host.querySelector('.session-badge.logged_in')).not.toBeNull()
    click(host.querySelector('button'))
    // The dialog must appear first; logout fires only on confirm.
    expect(host.querySelector('.dialog')).not.toBeNull()
    expect(onLogout).not.toHaveBeenCalled()
    const confirm = Array.from(host.querySelectorAll('.dialog-actions button')).find((b) => b.textContent === '退出')
    click(confirm ?? null)
    expect(onLogout).toHaveBeenCalledOnce()
  })


  it('ProviderPanel binds several capabilities from one key entry (批4 B3)', () => {
    const onSave = vi.fn()
    const host = mount(
      <ProviderPanel providers={null} busy={false} onSave={onSave} onRemove={() => undefined} />
    )
    // Check all three capability boxes, fill the required fields, submit.
    const boxes = host.querySelectorAll('.capability-check input[type="checkbox"]')
    expect(boxes).toHaveLength(3)
    for (const box of boxes) if (!(box as HTMLInputElement).checked) click(box)
    const inputs = host.querySelectorAll('.provider-form input.qa-input')
    input(inputs[0] as HTMLInputElement, 'DeepSeek')
    input(inputs[1] as HTMLInputElement, 'https://api.deepseek.com/v1')
    input(inputs[2] as HTMLInputElement, 'sk-test')
    input(inputs[3] as HTMLInputElement, 'deepseek-chat')
    const submit = Array.from(host.querySelectorAll('button')).find((b) => b.textContent!.includes('保存并绑定'))
    expect(submit?.textContent).toContain('3 项能力')
    click(submit ?? null)
    expect(onSave).toHaveBeenCalledWith({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      capabilities: ['asr', 'multimodal', 'text'],
      model: 'deepseek-chat'
    })
  })
  it('marks an expired session and offers re-login instead of logout', () => {
    const onLogin = vi.fn()
    const onLogout = vi.fn()
    const host = mount(<TopBar session="expired" busy={false} running={false} onLogin={onLogin} onLogout={onLogout} />)
    expect(host.querySelector('.session-badge.expired')?.textContent).toContain('已过期')
    const buttons = Array.from(host.querySelectorAll('button'))
    click(buttons.find((b) => b.textContent?.includes('重新登录')) ?? null)
    expect(onLogin).toHaveBeenCalledOnce()
    // No logout affordance for a dead session — logout clears nothing extra.
    expect(buttons.some((b) => b.textContent === '退出登录')).toBe(false)
  })
})

describe('ManualAdd', () => {
  it('collects course/lesson ids and calls onAdd, then clears', () => {
    const onAdd = vi.fn()
    const host = mount(<ManualAdd onAdd={onAdd} />)
    const fields = host.querySelectorAll<HTMLInputElement>('input.qa-input')
    input(fields[0], 'c9')
    input(fields[1], 'l9')
    click(host.querySelector('button'))
    expect(onAdd).toHaveBeenCalledWith('c9', 'l9')
    expect(fields[0]!.value).toBe('')
    expect(fields[1]!.value).toBe('')
  })
})

describe('ToastArea inline action (M1-3)', () => {
  it('renders the action button and fires onAction', () => {
    const onAction = vi.fn()
    const host = mount(
      <ToastArea toasts={[{ id: 1, message: '会话已恢复，2 个失败任务可重试', kind: 'success', actionLabel: '去任务页', onAction }]} />
    )
    const action = host.querySelector<HTMLButtonElement>('.toast-action')
    expect(action?.textContent).toBe('去任务页')
    click(action)
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('renders no action button when none is provided', () => {
    const host = mount(<ToastArea toasts={[{ id: 1, message: '普通提示', kind: 'info' }]} />)
    expect(host.querySelector('.toast-action')).toBeNull()
  })
})
