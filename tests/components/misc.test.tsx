import { describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { ToastArea, type ToastItem } from '../../src/renderer/components/ToastArea'
import { ProgressBar } from '../../src/renderer/components/ProgressBar'
import { EmptyState } from '../../src/renderer/components/EmptyState'
import { WelcomeGuide } from '../../src/renderer/components/WelcomeGuide'
import { ProviderPanel } from '../../src/renderer/components/ProviderPanel'
import { SettingsPanel } from '../../src/renderer/components/SettingsPanel'
import { TopBar } from '../../src/renderer/components/TopBar'
import { ManualAdd } from '../../src/renderer/components/ManualAdd'
import { useToasts, mergeToast } from '../../src/renderer/hooks/use-toasts'
import { Dialog } from '../../src/renderer/ui/Dialog'
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

  it('批2: 0% active renders the indeterminate slider instead of a frozen empty slot', () => {
    const starting = mount(<ProgressBar percent={0} active />)
    expect(starting.querySelector('.progress.indeterminate')).not.toBeNull()
    // A real percent keeps the determinate width (no indeterminate class).
    const midRun = mount(<ProgressBar percent={35} active />)
    expect(midRun.querySelector('.progress.indeterminate')).toBeNull()
    const idle = mount(<ProgressBar percent={0} active={false} />)
    expect(idle.querySelector('.progress.indeterminate')).toBeNull()
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

describe('WelcomeGuide (批1 双源并列: two parallel source paths)', () => {
  it('shows the three onboarding steps; step 1 offers BOTH sources', () => {
    const onLogin = vi.fn()
    const onOpenBili = vi.fn()
    const onSettings = vi.fn()
    const host = mount(<WelcomeGuide onLogin={onLogin} onOpenBili={onOpenBili} onOpenSettings={onSettings} />)
    const steps = host.querySelectorAll('.guide-steps li')
    expect(steps).toHaveLength(3)
    expect(steps[0]!.textContent).toContain('东大云课堂 / B站')
    const buttons = host.querySelectorAll('button')
    expect(buttons[0]!.textContent).toBe('登录东大云课堂')
    expect(buttons[1]!.textContent).toBe('导入 B站视频')
    click(buttons[0])
    expect(onLogin).toHaveBeenCalledOnce()
    click(buttons[1])
    expect(onOpenBili).toHaveBeenCalledOnce()
    click(buttons[2])
    expect(onSettings).toHaveBeenCalledOnce()
  })

  it('disables the login action while a login is in flight', () => {
    const onLogin = vi.fn()
    const host = mount(<WelcomeGuide onLogin={onLogin} onOpenBili={() => undefined} onOpenSettings={() => undefined} busy />)
    const loginButton = host.querySelector<HTMLButtonElement>('.empty-actions button.primary')
    expect(loginButton?.disabled).toBe(true)
    expect(host.textContent).toContain('登录中…')
    click(loginButton)
    expect(onLogin).not.toHaveBeenCalled()
  })
})

describe('TopBar (批1 双源并列: two parallel session badges)', () => {
  const baseProps = {
    biliSession: 'logged_out' as const,
    busy: false,
    running: false,
    onLogout: () => undefined,
    onOpenBili: () => undefined,
    onOpenTasks: () => undefined,
    onHome: () => undefined,
    breadcrumb: null,
    onClearLesson: () => undefined
  }

  it('logged-out SEU badge click fires onLogin (the badge IS the login affordance)', () => {
    const onLogin = vi.fn()
    const host = mount(<TopBar session="logged_out" {...baseProps} onLogin={onLogin} />)
    expect(host.querySelector('[data-testid="session-badge"]')?.textContent).toContain('东大·未登录')
    click(host.querySelector('[data-testid="session-badge"]'))
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('B站 badge renders in parallel and click opens the import dialog', () => {
    const onOpenBili = vi.fn()
    const host = mount(<TopBar session="logged_out" {...baseProps} onLogin={() => undefined} onOpenBili={onOpenBili} />)
    const bili = host.querySelector('[data-testid="bili-session-badge"]')
    expect(bili).not.toBeNull()
    expect(bili?.textContent).toContain('B站·未登录')
    expect(bili?.className).toContain('logged_out')
    click(bili)
    expect(onOpenBili).toHaveBeenCalledOnce()
  })

  it('logged-in B站 session flips the badge class and label', () => {
    const host = mount(<TopBar session="logged_out" {...baseProps} biliSession="logged_in" onLogin={() => undefined} />)
    const bili = host.querySelector('[data-testid="bili-session-badge"]')
    expect(bili?.className).toContain('logged_in')
    expect(bili?.textContent).toContain('B站·已登录')
  })

  it('批2: the running pill is a button that jumps to the tasks view', () => {
    const onOpenTasks = vi.fn()
    const host = mount(<TopBar session="logged_out" {...baseProps} running onOpenTasks={onOpenTasks} onLogin={() => undefined} />)
    const pill = host.querySelector('[data-testid="running-pill"]')
    expect(pill?.tagName).toBe('BUTTON')
    click(pill)
    expect(onOpenTasks).toHaveBeenCalledOnce()
  })

  it('brand click fires onHome (批A: back to the start view)', () => {
    const onHome = vi.fn()
    const host = mount(<TopBar session="logged_out" {...baseProps} onLogin={() => undefined} onHome={onHome} />)
    click(host.querySelector('.brand'))
    expect(onHome).toHaveBeenCalledOnce()
  })

  it('shows the course/lesson breadcrumb and clears the lesson from the course crumb (批A)', () => {
    const onClearLesson = vi.fn()
    const host = mount(
      <TopBar
        session="logged_in"
        {...baseProps}
        biliSession="logged_in"
        onLogin={() => undefined}
        breadcrumb={{ courseName: '数据结构', lessonTitle: '第4讲' }}
        onClearLesson={onClearLesson}
      />
    )
    expect(host.querySelector('.crumb-current')?.textContent).toBe('第4讲')
    click(host.querySelector('.crumb'))
    expect(onClearLesson).toHaveBeenCalledOnce()
  })

  it('logged-in SEU badge click opens the logout confirmation; logout fires only on confirm (批4 C4)', () => {
    const onLogout = vi.fn()
    const host = mount(<TopBar session="logged_in" {...baseProps} onLogin={() => undefined} onLogout={onLogout} />)
    expect(host.querySelector('.session-badge.logged_in')?.textContent).toContain('东大·已登录')
    click(host.querySelector('[data-testid="session-badge"]'))
    // The dialog must appear first; logout fires only on confirm.
    expect(host.querySelector('.dialog')).not.toBeNull()
    expect(onLogout).not.toHaveBeenCalled()
    const confirm = Array.from(host.querySelectorAll('.dialog-actions button')).find((b) => b.textContent === '退出')
    click(confirm ?? null)
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('批2: the logout dialog renders OUTSIDE <header> — the topbar backdrop-filter would flatten the fixed backdrop into a strip (顶对齐+黑栏根因)', () => {
    const host = mount(<TopBar session="logged_in" {...baseProps} onLogin={() => undefined} onLogout={() => undefined} />)
    click(host.querySelector('[data-testid="session-badge"]'))
    const backdrop = host.querySelector('.dialog-backdrop')
    expect(backdrop).not.toBeNull()
    expect(backdrop?.parentElement?.tagName.toLowerCase()).not.toBe('header')
    expect(host.querySelector('header .dialog-backdrop')).toBeNull()
  })

  it('marks an expired session; the badge click offers re-login, not logout', () => {
    const onLogin = vi.fn()
    const host = mount(<TopBar session="expired" {...baseProps} onLogin={onLogin} />)
    expect(host.querySelector('.session-badge.expired')?.textContent).toContain('东大·已过期')
    click(host.querySelector('[data-testid="session-badge"]'))
    expect(onLogin).toHaveBeenCalledOnce()
    expect(host.querySelector('.dialog')).toBeNull()
  })
})

describe('ProviderPanel (capability model inputs)', () => {
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
})

describe('ManualAdd (批5: busy + Enter + success-only clearing)', () => {
  it('collects course/lesson ids, calls onAdd, and clears ONLY on success', async () => {
    const onAdd = vi.fn(async () => true)
    const host = mount(<ManualAdd onAdd={onAdd} />)
    const fields = host.querySelectorAll<HTMLInputElement>('input.qa-input')
    input(fields[0], 'c9')
    input(fields[1], 'l9')
    click(host.querySelector('button'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(onAdd).toHaveBeenCalledWith('c9', 'l9')
    expect(fields[0]!.value).toBe('')
    expect(fields[1]!.value).toBe('')
  })

  it('a failed add keeps the ids (they are the expensive-to-retype part)', async () => {
    const onAdd = vi.fn(async () => false)
    const host = mount(<ManualAdd onAdd={onAdd} />)
    const fields = host.querySelectorAll<HTMLInputElement>('input.qa-input')
    input(fields[0], 'c9')
    input(fields[1], 'l9')
    click(host.querySelector('button'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fields[0]!.value).toBe('c9')
    expect(fields[1]!.value).toBe('l9')
    expect((host.querySelector('button') as HTMLButtonElement).textContent).toBe('添加课程与课时')
  })

  it('Enter submits and the empty-id guard blocks an incomplete form', async () => {
    let resolveAdd: (v: boolean) => void = () => undefined
    const onAdd = vi.fn(
      () => new Promise<boolean>((resolve) => {
        resolveAdd = resolve
      })
    )
    const host = mount(<ManualAdd onAdd={onAdd} />)
    const fields = host.querySelectorAll<HTMLInputElement>('input.qa-input')
    // Enter with only the course id filled must NOT fire a half request.
    input(fields[0], 'c1')
    fields[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onAdd).not.toHaveBeenCalled()
    input(fields[1], 'l1')
    fields[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(onAdd).toHaveBeenCalledWith('c1', 'l1')
    // Busy window: the button reads 添加中… until the add resolves.
    expect((host.querySelector('button') as HTMLButtonElement).textContent).toBe('添加中…')
    resolveAdd(true)
    await act(async () => {
      await Promise.resolve()
    })
    expect((host.querySelector('button') as HTMLButtonElement).textContent).toBe('添加课程与课时')
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

  it('批1 双源并列: the account block lists the B站 session in parallel with CAS', () => {
    const onBiliLogout = vi.fn()
    const host = mount(<SettingsPanel {...baseProps} settings={null} biliSession="logged_in" onBiliLogout={onBiliLogout} />)
    const row = host.querySelector('[data-testid="bili-account-settings"]')
    expect(row?.textContent).toContain('B站·已登录')
    click(Array.from(row!.querySelectorAll('button')).find((b) => b.textContent === '退出登录') ?? null)
    expect(onBiliLogout).toHaveBeenCalledOnce()
  })

  it('批1: a logged-out B站 session shows the state with no logout action', () => {
    const host = mount(<SettingsPanel {...baseProps} settings={null} biliSession="logged_out" />)
    expect(host.querySelector('[data-testid="bili-account-settings"]')?.textContent).toContain('B站·未登录')
    expect(host.querySelector('[data-testid="bili-account-settings"] button')).toBeNull()
  })

  it('批4: a failed config load surfaces an error row with retry instead of eternal blank', () => {
    const onRetryLoad = vi.fn()
    const host = mount(
      <SettingsPanel {...baseProps} settings={null} loadError={{ providers: '连接失败', settings: null }} onRetryLoad={onRetryLoad} />
    )
    const row = host.querySelector('[data-testid="settings-load-error"]')
    expect(row?.textContent).toContain('部分设置加载失败')
    expect(row?.textContent).toContain('连接失败')
    click(row!.querySelector('button'))
    expect(onRetryLoad).toHaveBeenCalledOnce()
  })
})

/** Harness exposing the latest useToasts state for hook assertions. */
function ToastHarness({ onState }: { onState: (s: ReturnType<typeof useToasts>) => void }): null {
  onState(useToasts())
  return null
}

describe('useToasts 批4 (error persistent + cap 3 + manual close)', () => {
  function harness(): { current: ReturnType<typeof useToasts> } {
    const ref: { current: ReturnType<typeof useToasts> } = { current: null as unknown as ReturnType<typeof useToasts> }
    mount(<ToastHarness onState={(s) => (ref.current = s)} />)
    return ref
  }

  it('an error toast survives its old auto-dismiss window and closes only manually', () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      act(() => {
        h.current.toast('导出失败：路径不可写', 'error')
      })
      expect(h.current.toasts).toHaveLength(1)
      // The old 6.5s auto-dismiss is gone — the error must be read, then closed.
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      expect(h.current.toasts).toHaveLength(1)
      act(() => {
        h.current.dismiss(h.current.toasts[0]!.id)
      })
      expect(h.current.toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('success toasts still auto-dismiss', () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      act(() => {
        h.current.toast('已保存', 'success')
      })
      act(() => {
        vi.advanceTimersByTime(4_000)
      })
      expect(h.current.toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps at 3 visible toasts — the oldest yields first (no TopBar occlusion)', () => {
    const h = harness()
    act(() => {
      h.current.toast('一')
      h.current.toast('二')
      h.current.toast('三')
      h.current.toast('四', 'error')
    })
    expect(h.current.toasts.map((t) => t.message)).toEqual(['二', '三', '四'])
  })
})

describe('useToasts D1 合并去重 (same kind+message merges with a count)', () => {
  function harness(): { current: ReturnType<typeof useToasts> } {
    const ref: { current: ReturnType<typeof useToasts> } = { current: null as unknown as ReturnType<typeof useToasts> }
    mount(<ToastHarness onState={(s) => (ref.current = s)} />)
    return ref
  }

  const entry = (id: number, message: string, kind: 'success' | 'error' | 'info' = 'error'): ToastItem => ({
    id,
    message,
    kind
  })

  it('a recurring identical error merges into one toast with an incremented count', () => {
    const merged = mergeToast([entry(1, '检测到代理接管了校园域名解析')], entry(2, '检测到代理接管了校园域名解析'))
    expect(merged).toHaveLength(1)
    expect(merged[0]!.count).toBe(2)
    expect(merged[0]!.id).toBe(1)
  })

  it('the merged toast moves to the end — recency decides what the FIFO cap evicts', () => {
    const list = [entry(1, '旧'), entry(2, '中'), entry(3, '新'), entry(4, '最新')]
    const merged = mergeToast(list, entry(5, '旧'))
    expect(merged.map((t) => t.message)).toEqual(['中', '新', '最新', '旧'])
    expect(merged[3]!.id).toBe(1)
    expect(merged[3]!.count).toBe(2)
  })

  it('different messages or kinds still enqueue separately', () => {
    const list = [entry(1, '同一句')]
    expect(mergeToast(list, entry(2, '另一句'))).toHaveLength(2)
    expect(mergeToast(list, entry(2, '同一句', 'info'))).toHaveLength(2)
  })

  it('a fresh entry beyond the cap still evicts the oldest', () => {
    const list = [entry(1, '一'), entry(2, '二'), entry(3, '三')]
    expect(mergeToast(list, entry(4, '四')).map((t) => t.message)).toEqual(['二', '三', '四'])
  })

  it('the hook routes repeats through the merge path', () => {
    const h = harness()
    act(() => {
      h.current.toast('检测到代理接管了校园域名解析', 'error')
      h.current.toast('检测到代理接管了校园域名解析', 'error')
      h.current.toast('检测到代理接管了校园域名解析', 'error')
    })
    expect(h.current.toasts).toHaveLength(1)
    expect(h.current.toasts[0]!.count).toBe(3)
  })

  it('健康巡查 2026-09-12: a merged (recurring) plain toast still auto-expires', () => {
    // The merge keeps the OLD entry id, so the old code's timer — which
    // dismissed the NEW id — filtered nothing and merged toasts lingered
    // until FIFO eviction.
    vi.useFakeTimers()
    try {
      const h = harness()
      act(() => {
        h.current.toast('已加载 6 门课程', 'success')
        h.current.toast('已加载 6 门课程', 'success')
        h.current.toast('已加载 6 门课程', 'success')
      })
      expect(h.current.toasts).toHaveLength(1)
      expect(h.current.toasts[0]!.count).toBe(3)
      act(() => {
        vi.advanceTimersByTime(4_000)
      })
      expect(h.current.toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('健康巡查 2026-09-12: a recurrence resets the merged toast lifetime', () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      act(() => {
        h.current.toast('复制成功', 'success')
      })
      act(() => {
        vi.advanceTimersByTime(3_000)
      })
      act(() => {
        // Second occurrence 3s in — the lifetime restarts from here.
        h.current.toast('复制成功', 'success')
      })
      act(() => {
        vi.advanceTimersByTime(3_000)
      })
      // 6s after the first push: the stale first timer must NOT have fired.
      expect(h.current.toasts).toHaveLength(1)
      expect(h.current.toasts[0]!.count).toBe(2)
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      expect(h.current.toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Dialog 焦点陷阱 (健康巡查 2026-09-12 批6)', () => {
  function openDialog(): { trigger: HTMLButtonElement; host: HTMLElement } {
    // A focused trigger outside the dialog — the element focus must return to.
    const trigger = document.createElement('button')
    trigger.textContent = '打开对话框'
    document.body.appendChild(trigger)
    trigger.focus()
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => {
      render(<Dialog open title="确认" message="内容" onConfirm={() => undefined} onCancel={() => undefined} />, host)
    })
    return { trigger, host }
  }

  const dialogButtons = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll('.dialog-actions button')) as HTMLButtonElement[]

  it('Tab from the last action wraps back to the first', () => {
    const { host } = openDialog()
    const buttons = dialogButtons()
    expect(buttons).toHaveLength(2)
    buttons[buttons.length - 1]!.focus()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    })
    expect(document.activeElement).toBe(buttons[0])
    render(null, host)
  })

  it('Shift+Tab from the first action wraps to the last', () => {
    const { host } = openDialog()
    const buttons = dialogButtons()
    buttons[0]!.focus()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    })
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    render(null, host)
  })

  it('Tab with focus outside the dialog pulls it back inside', () => {
    const { host } = openDialog()
    document.body.focus()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    })
    expect(dialogButtons().includes(document.activeElement as HTMLButtonElement)).toBe(true)
    render(null, host)
  })

  it('closing the dialog returns focus to the element that opened it', () => {
    const { trigger, host } = openDialog()
    act(() => {
      render(null, host)
    })
    expect(document.activeElement).toBe(trigger)
  })
})

describe('ToastArea D1 (recurrence count badge)', () => {
  it('shows the ×N badge only when a toast repeated', () => {
    const host = mount(
      <ToastArea
        toasts={[{ id: 1, message: '失败', kind: 'error', count: 3 }, { id: 2, message: '单次', kind: 'info' }]}
      />
    )
    const counts = host.querySelectorAll('.toast-count')
    expect(counts).toHaveLength(1)
    expect(counts[0]!.textContent).toBe('×3')
  })

  it('the count badge explains itself on hover', () => {
    const host = mount(<ToastArea toasts={[{ id: 1, message: '失败', kind: 'error', count: 2 }]} />)
    expect(host.querySelector('.toast-count')?.getAttribute('title')).toBe('同样的提示出现了 2 次')
  })
})

describe('ToastArea 批4 (kind icon + close button)', () => {
  it('renders a close button per toast and calls onDismiss with its id', () => {
    const onDismiss = vi.fn()
    const host = mount(
      <ToastArea toasts={[{ id: 7, message: '失败', kind: 'error' }]} onDismiss={onDismiss} />
    )
    const close = host.querySelector<HTMLButtonElement>('.toast-close')
    expect(close).not.toBeNull()
    click(close)
    expect(onDismiss).toHaveBeenCalledWith(7)
  })

  it('renders the kind icon (color alone must not carry the type)', () => {
    const host = mount(<ToastArea toasts={[{ id: 1, message: '失败', kind: 'error' }, { id: 2, message: '好了', kind: 'success' }]} />)
    expect(host.querySelectorAll('.toast-icon')).toHaveLength(2)
  })
})

describe('SettingsPanel 批5 细节', () => {
  const base = {
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
  const LOADED = { libraryRoot: 'L', cacheDir: 'C:/cache', theme: 'dark' as const }

  it('an expired session says «已于 X 过期» instead of presenting the past deadline as valid', () => {
    const past = Date.now() - 86_400_000
    const host = mount(
      <SettingsPanel
        {...base}
        session="expired"
        sessionInfo={{ savedAt: '2026-09-01T00:00:00Z', expiresAt: past }}
        settings={LOADED}
      />
    )
    expect(host.textContent).toContain('已于')
    expect(host.textContent).toContain('过期')
    expect(host.textContent).not.toContain('有效期至')
  })

  it('the theme select is disabled while settings load (no «跟随系统→深色» flash)', () => {
    const loading = mount(<SettingsPanel {...base} settings={null} />)
    expect((loading.querySelector('.theme-select') as HTMLSelectElement).disabled).toBe(true)
    const loaded = mount(<SettingsPanel {...base} settings={LOADED} />)
    expect((loaded.querySelector('.theme-select') as HTMLSelectElement).disabled).toBe(false)
  })

  it('the library path reads «加载中…» while settings load, not a bare ellipsis', () => {
    const host = mount(<SettingsPanel {...base} settings={null} />)
    expect(host.querySelector('.settings-path')?.textContent).toBe('加载中…')
  })

  it('缓存保存 is dirty-checked: unchanged value keeps the button disabled', () => {
    const onSetCacheDir = vi.fn()
    const host = mount(<SettingsPanel {...base} settings={LOADED} onSetCacheDir={onSetCacheDir} />)
    const save = (): HTMLButtonElement =>
      Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '保存') as HTMLButtonElement
    expect(save().disabled).toBe(true)
    click(save())
    expect(onSetCacheDir).not.toHaveBeenCalled()
  })

  it('a finished migration keeps a persistent restart notice on screen', () => {
    const host = mount(<SettingsPanel {...base} settings={LOADED} libraryMigrated />)
    expect(host.querySelector('[data-testid="migration-restart-notice"]')?.textContent).toContain('重启应用后生效')
  })
})
