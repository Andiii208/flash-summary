import { describe, expect, it, vi } from 'vitest'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { BiliImportDialog } from '../../src/renderer/components/BiliImportDialog'
import { mount, click, input } from '../helpers/preact'
import { waitFor } from '../helpers/wait-for'
import type { SeuSummaryBridge } from '../../src/shared/bridge'

const RESOLVE_PAYLOAD = {
  bvid: 'BV1GJ411x7h7',
  requestedPage: null,
  title: '线性代数全集',
  coverUrl: '',
  upMid: 5,
  pages: [
    { page: 1, cid: 1, part: 'P1 行列式', duration: 300 },
    { page: 2, cid: 2, part: 'P2 矩阵', duration: 420 }
  ]
}

/** Bridge stub covering only the bilibili surface the dialog touches. */
function makeBridge(overrides: Partial<Record<string, unknown>> = {}): SeuSummaryBridge {
  const bilibili = {
    login: vi.fn(async () => ({ ok: true, value: { qrUrl: 'https://passport.bilibili.com/qr?qrcode_key=K1' } })),
    loginStatus: vi.fn(async () => ({ ok: true, value: { status: 'confirmed' as const } })),
    logout: vi.fn(async () => ({ ok: true, value: { state: 'logged_out' as const } })),
    session: vi.fn(async () => ({ ok: true, value: { state: 'logged_out' as const, savedAt: null } })),
    resolve: vi.fn(async () => ({ ok: true, value: RESOLVE_PAYLOAD })),
    import: vi.fn(async (payload: { bvid: string; pages: number[] }) => ({
      ok: true,
      value: { courseId: `bili-${payload.bvid}`, lessonIds: payload.pages.map((p) => `bili-${payload.bvid}-P${p}`) }
    })),
    ...overrides
  }
  return { bilibili } as unknown as SeuSummaryBridge
}

interface DialogProps {
  bridge: SeuSummaryBridge
  open: boolean
  sessionState: 'logged_in' | 'logged_out' | null
  onSessionRefresh: () => void
  onLogout: () => void
  onImported: (courseId: string, lessonIds: string[]) => void
  onClose: () => void
  toast: (message: string, kind?: 'info' | 'error' | 'success') => void
}

function makeProps(bridge: SeuSummaryBridge, overrides: Partial<DialogProps> = {}): DialogProps {
  return {
    bridge,
    open: true,
    sessionState: 'logged_out',
    onSessionRefresh: vi.fn(),
    onLogout: vi.fn(),
    onImported: vi.fn(),
    onClose: vi.fn(),
    toast: vi.fn(),
    ...overrides
  }
}

/** Flush the async resolve chain inside act so Preact state updates land. */
async function flush(ticks = 3): Promise<void> {
  await act(async () => {
    for (let i = 0; i < ticks; i++) await Promise.resolve()
  })
}

async function resolveTo(props: DialogProps): Promise<HTMLElement> {
  const host = mount(<BiliImportDialog {...props} />)
  input(host.querySelector('.bili-row .qa-input'), 'https://www.bilibili.com/video/BV1GJ411x7h7')
  click([...host.querySelectorAll('button')].find((b) => b.textContent === '解析') ?? null)
  await flush()
  return host
}

describe('BiliImportDialog (批1 双源并列: first-class import dialog)', () => {
  it('closed renders nothing; open re-checks the session and starts blank', () => {
    const bridge = makeBridge()
    const onSessionRefresh = vi.fn()
    const closed = mount(<BiliImportDialog {...makeProps(bridge, { open: false, onSessionRefresh })} />)
    expect(closed.querySelector('.bili-dialog-card')).toBeNull()
    const host = mount(<BiliImportDialog {...makeProps(bridge, { onSessionRefresh })} />)
    expect(host.querySelector('[data-testid="bili-import-dialog"]')).not.toBeNull()
    expect(onSessionRefresh).toHaveBeenCalled()
    expect(host.querySelector('.bili-preview')).toBeNull()
    // The account row always shows the current state (settings/TopBar parity).
    expect(host.querySelector('[data-testid="bili-account-row"]')?.textContent).toContain('B站·未登录')
  })

  it('resolve fills the preview; every page chip is preselected when there are few', async () => {
    const host = await resolveTo(makeProps(makeBridge()))
    const chips = host.querySelectorAll('.bili-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(chips[1]!.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('共 2 个分P')
  })

  it('import with a logged-in session calls through with the selected pages, then closes', async () => {
    const bridge = makeBridge()
    const onImported = vi.fn()
    const onClose = vi.fn()
    const props = makeProps(bridge, { sessionState: 'logged_in', onImported, onClose })
    const host = await resolveTo(props)
    // Deselect P2, import only P1 (chips are toggle buttons with aria-pressed).
    const chips = host.querySelectorAll('.bili-chip')
    expect(chips).toHaveLength(2)
    click(chips[1]!)
    expect(host.querySelectorAll('.bili-chip')[1]!.getAttribute('aria-pressed')).toBe('false')
    click(host.querySelector('.bili-import-btn'))
    await flush()
    expect(bridge.bilibili.import).toHaveBeenCalledWith({ bvid: 'BV1GJ411x7h7', pages: [1] })
    expect(onImported).toHaveBeenCalledWith('bili-BV1GJ411x7h7', ['bili-BV1GJ411x7h7-P1'])
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('logged-out session routes the import through the QR login flow inside the dialog', async () => {
    const bridge = makeBridge()
    const host = await resolveTo(makeProps(bridge))
    click(host.querySelector('.bili-import-btn'))
    await flush()
    expect(bridge.bilibili.login).toHaveBeenCalled()
    // The QR area renders inside the dialog and polls (status line visible);
    // the <img> itself only appears once the QR encoder finishes rendering.
    expect(host.querySelector('.bili-qr')).not.toBeNull()
    expect(host.textContent).toContain('等待扫码')
  })

  it('批5 (P15): 扫码等待期间主按钮禁用并读「等待扫码…」，再点不会重新取码', async () => {
    const bridge = makeBridge({ loginStatus: vi.fn(async () => ({ ok: true, value: { status: 'waiting' as const } })) })
    const host = await resolveTo(makeProps(bridge))
    const main = (): HTMLButtonElement => host.querySelector('.bili-import-btn') as HTMLButtonElement
    expect(main().disabled).toBe(false)
    click(main())
    await flush()
    expect(bridge.bilibili.login).toHaveBeenCalledOnce()
    expect(host.querySelector('.bili-qr')).not.toBeNull()
    // 等待扫码：按钮置灰 + busy 三件套的文案形态（省略号）。二维码渲染（QRCode
    // toDataURL）在 finally 之前，等它落地才算真的进相位。
    await waitFor(() => expect(main().textContent).toContain('等待扫码…'))
    expect(main().disabled).toBe(true)
    // 再点一次不能让 qrcodeKey 被重新取码覆写（手机上已扫的码会就此失效）。
    // 这里用原生事件派发（绕过 disabled 的激活抑制），量的正是 onImportClick 的同一守卫。
    click(main())
    await flush()
    expect(bridge.bilibili.login).toHaveBeenCalledOnce()
    expect(host.querySelector('.bili-qr')).not.toBeNull()
  })

  it('a failed resolve surfaces the error as a toast and no preview appears', async () => {
    const bridge = makeBridge({ resolve: vi.fn(async () => ({ ok: false, error: '该视频为付费内容，不支持导入' })) })
    const toast = vi.fn()
    const host = await resolveTo(makeProps(bridge, { toast }))
    expect(host.querySelector('.bili-preview')).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('付费'), 'error')
  })

  it('logged-in account row offers logout through the app handler', async () => {
    const bridge = makeBridge()
    const onLogout = vi.fn()
    const host = mount(<BiliImportDialog {...makeProps(bridge, { sessionState: 'logged_in', onLogout })} />)
    expect(host.querySelector('[data-testid="bili-account-row"]')?.textContent).toContain('B站·已登录')
    click(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '退出登录') ?? null)
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('Escape closes the dialog (same convention as the other modals)', () => {
    const bridge = makeBridge()
    const onClose = vi.fn()
    mount(<BiliImportDialog {...makeProps(bridge, { onClose })} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('健康巡查 2026-09-12: the QR poll interval survives parent re-renders (progress streaming)', async () => {
    // Regression: the polling effect had no deps array, so every parent
    // re-render tore down and recreated the 2s interval — and App re-renders
    // more often than that while a task streams progress. The QR flow starved
    // at «等待扫码…» forever.
    vi.useFakeTimers()
    try {
      const bridge = makeBridge({ loginStatus: vi.fn(async () => ({ ok: true, value: { status: 'waiting' as const } })) })
      const host = await resolveTo(makeProps(bridge))
      click(host.querySelector('.bili-import-btn'))
      await flush()
      expect(host.querySelector('.bili-qr')).not.toBeNull()
      const loginStatus = bridge.bilibili.loginStatus as ReturnType<typeof vi.fn>
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(loginStatus).toHaveBeenCalled()
      const afterFirst = loginStatus.mock.calls.length
      // Simulate the App progress loop: frequent re-renders of the same
      // dialog instance with fresh prop identities. The interval must keep
      // ticking across them.
      for (let round = 0; round < 5; round++) {
        act(() => {
          render(<BiliImportDialog {...makeProps(bridge)} />, host)
        })
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000)
        })
      }
      // 5s of elapsed time across 5 re-renders → at least two more polls.
      expect(loginStatus.mock.calls.length).toBeGreaterThan(afterFirst + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('健康巡查 2026-09-12 批5: the resolve button reads 解析中… while resolving', async () => {
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((r) => {
      release = r
    })
    const bridge = makeBridge({
      resolve: vi.fn(async () => {
        await gate
        return { ok: true, value: RESOLVE_PAYLOAD }
      })
    })
    const host = mount(<BiliImportDialog {...makeProps(bridge)} />)
    input(host.querySelector('.bili-row .qa-input'), 'https://www.bilibili.com/video/BV1GJ411x7h7')
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '解析') ?? null)
    await flush()
    const resolving = [...host.querySelectorAll('button')].find((b) => b.textContent === '解析中…') as HTMLButtonElement | undefined
    expect(resolving).not.toBeNull()
    expect(resolving!.disabled).toBe(true)
    await act(async () => {
      release(undefined)
      await Promise.resolve()
    })
    await flush()
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === '解析')).toBe(true)
  })

  it('批4: 扫码登录在途时主按钮读「登录中…」且 disabled（busyKind 覆盖登录，连点不出第二个 IPC）', async () => {
    let release: (value: unknown) => void = () => undefined
    const gate = new Promise((r) => {
      release = r
    })
    const bridge = makeBridge({
      login: vi.fn(async () => {
        await gate
        return { ok: true, value: { qrUrl: 'https://passport.bilibili.com/qr?qrcode_key=K1' } }
      })
    })
    const host = await resolveTo(makeProps(bridge))
    click(host.querySelector('.bili-import-btn'))
    await flush()
    // busyKind === 'login'：按钮文案换「登录中…」并置灰（此前只有 busy 无 kind，
    // 登录在途时按钮仍读「扫码登录后导入」，违反 AGENTS.md busy 约定）。
    const loginBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === '登录中…') as HTMLButtonElement | undefined
    expect(loginBtn).not.toBeNull()
    expect(loginBtn!.disabled).toBe(true)
    // in-flight 守卫：busy 期间再点不会发出第二个 login IPC。
    click(host.querySelector('.bili-import-btn'))
    await flush()
    expect(bridge.bilibili.login).toHaveBeenCalledTimes(1)
    await act(async () => {
      release(undefined)
      await Promise.resolve()
    })
    await flush()
    // IPC 落定后恢复可读标签（QR 编码随后异步完成，等 busy 清除而不是拍时长）。
    await waitFor(() => {
      expect([...host.querySelectorAll('button')].some((b) => b.textContent === '扫码登录后导入')).toBe(true)
    })
  })
})
