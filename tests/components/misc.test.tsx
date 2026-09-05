import { describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { ToastArea } from '../../src/renderer/components/ToastArea'
import { ProgressBar } from '../../src/renderer/components/ProgressBar'
import { EmptyState } from '../../src/renderer/components/EmptyState'
import { WelcomeGuide } from '../../src/renderer/components/WelcomeGuide'
import { ProviderPanel } from '../../src/renderer/components/ProviderPanel'
import { SettingsPanel } from '../../src/renderer/components/SettingsPanel'
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
  /** 批A: the brand button renders first — target session buttons explicitly. */
  const btnByText = (host: HTMLElement, text: string): HTMLButtonElement | null =>
    (Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined) ?? null

  it('shows login when logged out and fires onLogin', () => {
    const onLogin = vi.fn()
    const host = mount(<TopBar session="logged_out" busy={false} running={false} onLogin={onLogin} onLogout={() => undefined} onHome={() => undefined} breadcrumb={null} onClearLesson={() => undefined} />)
    expect(host.textContent).toContain('登录 CAS')
    click(btnByText(host, '登录 CAS'))
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('brand click fires onHome (批A: back to the start view)', () => {
    const onHome = vi.fn()
    const host = mount(<TopBar session="logged_out" busy={false} running={false} onLogin={() => undefined} onLogout={() => undefined} onHome={onHome} breadcrumb={null} onClearLesson={() => undefined} />)
    click(host.querySelector('.brand'))
    expect(onHome).toHaveBeenCalledOnce()
  })

  it('shows the course/lesson breadcrumb and clears the lesson from the course crumb (批A)', () => {
    const onClearLesson = vi.fn()
    const host = mount(
      <TopBar
        session="logged_in"
        busy={false}
        running={false}
        onLogin={() => undefined}
        onLogout={() => undefined}
        onHome={() => undefined}
        breadcrumb={{ courseName: '数据结构', lessonTitle: '第4讲' }}
        onClearLesson={onClearLesson}
      />
    )
    expect(host.querySelector('.crumb-current')?.textContent).toBe('第4讲')
    click(host.querySelector('.crumb'))
    expect(onClearLesson).toHaveBeenCalledOnce()
  })

  it('shows logout when logged in with a session badge, behind a confirmation (批4 C4)', () => {
    const onLogout = vi.fn()
    const host = mount(<TopBar session="logged_in" busy={false} running={false} onLogin={() => undefined} onLogout={onLogout} onHome={() => undefined} breadcrumb={null} onClearLesson={() => undefined} />)
    expect(host.textContent).toContain('已登录')
    expect(host.querySelector('.session-badge.logged_in')).not.toBeNull()
    click(btnByText(host, '退出登录'))
    // The dialog must appear first; logout fires only on confirm.
    expect(host.querySelector('.dialog')).not.toBeNull()
    expect(onLogout).not.toHaveBeenCalled()
    const confirm = Array.from(host.querySelectorAll('.dialog-actions button')).find((b) => b.textContent === '退出')
    click(confirm ?? null)
    expect(onLogout).toHaveBeenCalledOnce()
  })


  it('ProviderPanel saves one model PER capability from per-field inputs (2026-09-05 批4)', () => {
    const onSave = vi.fn()
    const host = mount(<ProviderPanel providers={null} busy={false} onSave={onSave} onRemove={() => undefined} />)
    // Check all three capability boxes; per-capability model inputs appear.
    const boxes = host.querySelectorAll('.capability-check input[type="checkbox"]')
    expect(boxes).toHaveLength(3)
    for (const box of boxes) if (!(box as HTMLInputElement).checked) click(box)
    const modelInput = (label: string): HTMLInputElement => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
    expect(modelInput('ASR 转写模型')!.placeholder).toContain('whisper-1')
    expect(modelInput('ASR 转写模型')!.value).toBe('')
    expect(modelInput('多模态总结模型')!.value).toBe('gpt-4o')
    input(modelInput('ASR 转写模型'), 'whisper-1')
    input(host.querySelector('input[type="password"]') as HTMLInputElement, 'sk-test')
    const submit = Array.from(host.querySelectorAll('button')).find((b) => b.textContent!.includes('保存并绑定'))
    expect(submit?.textContent).toContain('3 项能力')
    click(submit ?? null)
    expect(onSave).toHaveBeenCalledWith({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      capabilities: ['asr', 'multimodal', 'text'],
      models: { asr: 'whisper-1', multimodal: 'gpt-4o', text: 'gpt-4o' }
    })
  })

  it('ProviderPanel blocks save until every bound capability has a model (2026-09-05 批4)', () => {
    const onSave = vi.fn()
    const host = mount(<ProviderPanel providers={null} busy={false} onSave={onSave} onRemove={() => undefined} />)
    // Default state: ASR checked with an EMPTY model on purpose — the trap
    // this redesign removes; save must stay disabled until it is filled.
    const submit = Array.from(host.querySelectorAll('button')).find((b) => b.textContent!.includes('保存并绑定')) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    input(host.querySelector('input[aria-label="ASR 转写模型"]') as HTMLInputElement, 'mimo-v2.5-asr')
    expect(submit.disabled).toBe(true) // still no API key for a first provider
    input(host.querySelector('input[type="password"]') as HTMLInputElement, 'sk-test')
    expect(submit.disabled).toBe(false)
    click(submit)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('ProviderPanel disables «测试连接» until the API key is filled (P7)', () => {
    const onTest = vi.fn()
    const host = mount(<ProviderPanel providers={null} busy={false} onSave={() => undefined} onRemove={() => undefined} onTest={onTest} />)
    const test = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '测试连接') as HTMLButtonElement
    expect(test.disabled).toBe(true)
    input(host.querySelector('input[type="password"]') as HTMLInputElement, 'sk-test')
    input(host.querySelector('input[aria-label="ASR 转写模型"]') as HTMLInputElement, 'mimo-v2.5-asr')
    expect(test.disabled).toBe(false)
    click(test)
    expect(onTest).toHaveBeenCalledWith({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'mimo-v2.5-asr' })
  })

  it('ProviderPanel edit refills identity + per-capability bindings in place (2026-09-05 批4)', () => {
    const onSave = vi.fn()
    const providers = {
      providers: [{ id: 'p1', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hasKey: true }],
      bindings: [{ capability: 'asr', providerId: 'p1', model: 'mimo-v2.5-asr' }]
    }
    const host = mount(<ProviderPanel providers={providers} busy={false} onSave={onSave} onRemove={() => undefined} />)
    // The list leads; the form is collapsed until «编辑».
    expect(host.querySelector('.provider-row .provider-row-name')?.textContent).toContain('DeepSeek')
    expect(host.querySelector('.provider-row-bindings')?.textContent).toContain('ASR 转写: mimo-v2.5-asr')
    const details = host.querySelector('details.provider-add') as HTMLDetailsElement
    expect(details.open).toBe(false)
    click(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '编辑') ?? null)
    // key={editingId} re-mounts the details so «编辑» opens it — re-query.
    const reopened = host.querySelector('details.provider-add') as HTMLDetailsElement
    expect(reopened.open).toBe(true)
    expect((reopened.querySelector('input[placeholder^="Base URL"]') as HTMLInputElement).value).toBe('https://api.deepseek.com/v1')
    expect(reopened.querySelector('input[aria-label="ASR 转写模型"]') !== null).toBe(true)
    expect((reopened.querySelector('input[aria-label="ASR 转写模型"]') as HTMLInputElement).value).toBe('mimo-v2.5-asr')
    // Saving an edit keeps the provider id and lets the key stay empty.
    input(reopened.querySelector('input[aria-label="ASR 转写模型"]') as HTMLInputElement, 'whisper-1')
    click(Array.from(reopened.querySelectorAll('button')).find((b) => b.textContent === '保存修改') ?? null)
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: { asr: 'whisper-1' } })
    )
  })
  it('marks an expired session and offers re-login instead of logout', () => {
    const onLogin = vi.fn()
    const onLogout = vi.fn()
    const host = mount(<TopBar session="expired" busy={false} running={false} onLogin={onLogin} onLogout={onLogout} onHome={() => undefined} breadcrumb={null} onClearLesson={() => undefined} />)
    expect(host.querySelector('.session-badge.expired')?.textContent).toContain('已过期')
    click(btnByText(host, '重新登录'))
    expect(onLogin).toHaveBeenCalledOnce()
    // No logout affordance for a dead session — logout clears nothing extra.
    expect(btnByText(host, '退出登录')).toBeNull()
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

describe('SettingsPanel cache-dir draft (P6, 2026-09-05)', () => {
  const baseProps = {
    session: 'logged_out' as const,
    sessionInfo: { savedAt: null, expiresAt: null },
    sessionBusy: false,
    onLogin: () => undefined,
    onLogout: () => undefined,
    providers: null,
    providerBusy: false,
    onSaveProvider: () => undefined,
    onRemoveProvider: () => undefined,
    onSetCacheDir: () => undefined,
    onSetTheme: () => undefined,
    onChooseLibrary: () => undefined,
    onOpenPath: () => undefined
  }

  it('refills the cache draft when settings arrive after mount', () => {
    const host = mount(<SettingsPanel {...baseProps} settings={null} />)
    const draft = (): HTMLInputElement => host.querySelector('.settings-row input.qa-input') as HTMLInputElement
    expect(draft().value).toBe('')
    // Settings load async (settings tab restored as the initial tab): the
    // configured dir must reach the input instead of leaving it blank.
    act(() => {
      render(<SettingsPanel {...baseProps} settings={{ libraryRoot: 'L', cacheDir: 'C:\\lib\\cache', theme: 'auto' }} />, host)
    })
    expect(draft().value).toBe('C:\\lib\\cache')
  })
})
