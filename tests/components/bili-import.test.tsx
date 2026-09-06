import { describe, expect, it, vi } from 'vitest'
import { act } from 'preact/test-utils'
import { BiliImport } from '../../src/renderer/components/BiliImport'
import { mount, click, input } from '../helpers/preact'
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

/** Bridge stub covering only the bilibili surface the panel touches. */
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

function makeToast(): { toast: (m: string, k?: 'info' | 'error' | 'success') => void; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = []
  return { toast: (m, k = 'info') => calls.push([m, k]), calls }
}

/** Flush the async resolve chain inside act so Preact state updates land. */
async function flush(ticks = 3): Promise<void> {
  await act(async () => {
    for (let i = 0; i < ticks; i++) await Promise.resolve()
  })
}

async function resolveTo(bridge: SeuSummaryBridge, toast: (m: string, k?: 'info' | 'error' | 'success') => void, onImported: (c: string, l: string[]) => void): Promise<HTMLElement> {
  const host = mount(<BiliImport bridge={bridge} onImported={onImported} toast={toast} />)
  input(host.querySelector('.bili-row .qa-input'), 'https://www.bilibili.com/video/BV1GJ411x7h7')
  click([...host.querySelectorAll('button')].find((b) => b.textContent === '解析') ?? null)
  await flush()
  return host
}

describe('BiliImport (plan 2026-09-06 M5)', () => {
  it('resolve fills the preview; every page chip is preselected when there are few', async () => {
    const host = await resolveTo(makeBridge(), () => undefined, () => undefined)
    const chips = host.querySelectorAll('.bili-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(chips[1]!.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('共 2 个分P')
  })

  it('import with a logged-in session calls through with the selected pages', async () => {
    const bridge = makeBridge({ session: vi.fn(async () => ({ ok: true, value: { state: 'logged_in' as const, savedAt: 'x' } })) })
    const onImported = vi.fn()
    const { toast } = makeToast()
    const host = await resolveTo(bridge, toast, onImported)
    // Deselect P2, import only P1 (chips are toggle buttons with aria-pressed).
    const chips = host.querySelectorAll('.bili-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true')
    click(chips[1]!)
    expect(host.querySelectorAll('.bili-chip')[1]!.getAttribute('aria-pressed')).toBe('false')
    click(host.querySelector('.bili-import-btn'))
    await flush()
    expect(bridge.bilibili.import).toHaveBeenCalledWith({ bvid: 'BV1GJ411x7h7', pages: [1] })
    expect(onImported).toHaveBeenCalledWith('bili-BV1GJ411x7h7', ['bili-BV1GJ411x7h7-P1'])
  })

  it('logged-out session routes the import through the QR login flow', async () => {
    const bridge = makeBridge()
    const { toast } = makeToast()
    const host = await resolveTo(bridge, toast, () => undefined)
    click(host.querySelector('.bili-import-btn'))
    await flush()
    expect(bridge.bilibili.login).toHaveBeenCalled()
    // The panel enters the QR state and polls (status line visible); the
    // <img> itself only appears once the QR encoder finishes rendering.
    expect(host.querySelector('.bili-qr')).not.toBeNull()
    expect(host.textContent).toContain('等待扫码')
  })

  it('a failed resolve surfaces the error as a toast and no preview appears', async () => {
    const bridge = makeBridge({ resolve: vi.fn(async () => ({ ok: false, error: '该视频为付费内容，不支持导入' })) })
    const calls = makeToast()
    const host = await resolveTo(bridge, calls.toast, () => undefined)
    expect(host.querySelector('.bili-preview')).toBeNull()
    expect(calls.calls.some(([m, k]) => m.includes('付费') && k === 'error')).toBe(true)
  })
})
