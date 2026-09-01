import { describe, expect, it, vi } from 'vitest'
import { ToastArea } from '../../src/renderer/components/ToastArea'
import { ProgressBar } from '../../src/renderer/components/ProgressBar'
import { EmptyState } from '../../src/renderer/components/EmptyState'
import { WelcomeGuide } from '../../src/renderer/components/WelcomeGuide'
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
    const host = mount(<TopBar session="logged_out" busy={false} onLogin={onLogin} onLogout={() => undefined} />)
    expect(host.textContent).toContain('登录 CAS')
    click(host.querySelector('button'))
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('shows logout when logged in with a session badge', () => {
    const onLogout = vi.fn()
    const host = mount(<TopBar session="logged_in" busy={false} onLogin={() => undefined} onLogout={onLogout} />)
    expect(host.textContent).toContain('已登录')
    expect(host.querySelector('.session-badge.logged_in')).not.toBeNull()
    click(host.querySelector('button'))
    expect(onLogout).toHaveBeenCalledOnce()
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
