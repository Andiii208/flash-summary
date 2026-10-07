import { describe, expect, it, vi, beforeEach } from 'vitest'
import { App } from '../../src/renderer/App'
import { sidebarMetaLine } from '../../src/renderer/App'
import { mount, click } from '../helpers/preact'
import type { SeuSummaryBridge, TermOption } from '../../src/shared/bridge'
import type { ApiResult } from '../../src/shared/api-result'
import { makeBridge, ok, fakeState, NOTE_ROWS, TASK_ROWS, setListTotals } from '../helpers/fake-app-bridge'

/**
 * 批3 (plan 2026-10-07): the refresh-area semester selector — site parity for
 * «which semester does 刷新课程 cover». These are the renderer half of the
 * feature; the main-side acteId plumbing is covered in ipc/school-client tests.
 */

function setNarrowViewport(narrow: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}

async function waitForSelector(selector: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (document.querySelector(selector) == null) throw new Error(`waiting for ${selector}`)
    },
    { timeout: 8000, interval: 25 }
  )
}

function loggedInBridge(terms: TermOption[], rememberedActeId: number | null = null): SeuSummaryBridge {
  const bridge = makeBridge()
  bridge.school.session = vi.fn(async () => ok({ state: 'logged_in' as const }))
  bridge.school.listTerms = vi.fn(async (): Promise<ApiResult<TermOption[]>> => ok(terms))
  bridge.school.refreshTerm = vi.fn(async () => ok({ acteId: rememberedActeId }))
  return bridge
}

const TERMS: TermOption[] = [
  { id: 37, academicYear: '2026-2027', term: 2, currentTerm: false, label: '2026-2027 第二学期' },
  { id: 36, academicYear: '2026-2027', term: 1, currentTerm: true, label: '2026-2027 第一学期' }
]

describe('刷新学期 selector (plan 2026-10-07, 批3)', () => {
  beforeEach(() => {
    setNarrowViewport(false)
    NOTE_ROWS.length = 0
    TASK_ROWS.length = 0
    setListTotals(0, 0)
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    window.localStorage.clear()
    fakeState.disclaimerAccepted = true
    Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true, configurable: true })
  })

  it('renders the platform term catalog next to 刷新课程 and defaults to 当前学期', { timeout: 8000 }, async () => {
    const bridge = loggedInBridge(TERMS)
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('[data-testid="refresh-term-select"]')
    const select = host.querySelector('[data-testid="refresh-term-select"]') as HTMLSelectElement
    expect(select.value).toBe('')
    const labels = [...select.options].map((o) => o.textContent)
    expect(labels).toEqual(['当前学期', '2026-2027 第二学期', '2026-2027 第一学期（当前）'])
    expect(bridge.school.listTerms).toHaveBeenCalled()
  })

  it('picking a semester persists it and scopes the next refresh to it', { timeout: 8000 }, async () => {
    const bridge = loggedInBridge(TERMS)
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('[data-testid="refresh-term-select"]')
    const select = host.querySelector('[data-testid="refresh-term-select"]') as HTMLSelectElement
    select.value = '37'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(bridge.school.setRefreshTerm).toHaveBeenCalledWith(37))

    const refreshBtn = [...host.querySelectorAll('.sidebar-head button')].find((b) => b.textContent === '刷新课程')
    click(refreshBtn!)
    await vi.waitFor(() => expect(bridge.school.listCourses).toHaveBeenCalled())
    expect(bridge.school.listCourses).toHaveBeenCalledWith(37)
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="tree-meta"]')?.textContent).toContain('2026-2027 第二学期')
    })
  })

  it('a remembered semester drives the refresh without another pick (restart parity)', { timeout: 8000 }, async () => {
    const bridge = loggedInBridge(TERMS, 37)
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('[data-testid="refresh-term-select"]')
    await vi.waitFor(() => {
      expect((host.querySelector('[data-testid="refresh-term-select"]') as HTMLSelectElement).value).toBe('37')
    })
    const refreshBtn = [...host.querySelectorAll('.sidebar-head button')].find((b) => b.textContent === '刷新课程')
    click(refreshBtn!)
    await vi.waitFor(() => expect(bridge.school.listCourses).toHaveBeenCalledWith(37))
  })

  it('current-term default keeps the unfiltered refresh (historical behavior)', { timeout: 8000 }, async () => {
    const bridge = loggedInBridge(TERMS)
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('[data-testid="refresh-term-select"]')
    const refreshBtn = [...host.querySelectorAll('.sidebar-head button')].find((b) => b.textContent === '刷新课程')
    click(refreshBtn!)
    await vi.waitFor(() => expect(bridge.school.listCourses).toHaveBeenCalled())
    expect(bridge.school.listCourses).toHaveBeenCalledWith(undefined)
    // No semester scope in the meta line: the wording must not claim one.
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="tree-meta"]')?.textContent).toContain('本次刷新')
    })
    expect(host.querySelector('[data-testid="tree-meta"]')?.textContent).not.toContain('（20')
  })

  it('a catalog failure degrades to the single 当前学期 entry with the refresh still usable (D7)', { timeout: 8000 }, async () => {
    const bridge = loggedInBridge(TERMS)
    bridge.school.listTerms = vi.fn(async (): Promise<ApiResult<TermOption[]>> => ({ ok: false, error: 'catalog down' }))
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('[data-testid="refresh-term-select"]')
    const select = host.querySelector('[data-testid="refresh-term-select"]') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['当前学期'])
    const refreshBtn = [...host.querySelectorAll('.sidebar-head button')].find((b) => b.textContent === '刷新课程')
    expect(refreshBtn?.hasAttribute('disabled')).toBe(false)
    click(refreshBtn!)
    await vi.waitFor(() => expect(bridge.school.listCourses).toHaveBeenCalledWith(undefined))
  })

  it('the selector is hidden when logged out', { timeout: 8000 }, async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    await vi.waitFor(() => expect(bridge.school.session).toHaveBeenCalled())
    expect(host.querySelector('[data-testid="refresh-term-select"]')).toBeNull()
  })
})

describe('sidebarMetaLine semester scope (plan 2026-10-07, 批3)', () => {
  it('names the semester a scoped refresh covered', () => {
    expect(
      sidebarMetaLine(false, null, { loaded: 3, platformTotal: 3000, termLabel: '2026-2027 第二学期' }, 100)
    ).toBe('本地已收录 100 门 · 本次刷新 3 门（2026-2027 第二学期） · 平台列表约 3000 门（搜索只查本地已收录的课）')
  })

  it('keeps the unscoped wording when no semester label is present', () => {
    expect(sidebarMetaLine(false, null, { loaded: 12, platformTotal: 500 }, 100)).toBe(
      '本地已收录 100 门 · 本次刷新 12 门 · 平台列表约 500 门（搜索只查本地已收录的课）'
    )
  })

  it('an empty scoped refresh says which semester was empty, not just that nothing came back', () => {
    const line = sidebarMetaLine(false, null, { loaded: 0, platformTotal: 3000, termLabel: '2025-2026 第一学期' }, 100)
    expect(line).toContain('本次刷新 0 门（2025-2026 第一学期）')
    expect(line).toContain('平台返回了空列表')
  })

  it('the busy line is unchanged by the semester scope', () => {
    expect(sidebarMetaLine(true, { page: 2, pageCount: 6 }, { loaded: 0, platformTotal: 0 }, 100)).toBe(
      '正在刷新第 2/6 页… · 本地已收录 100 门'
    )
  })
})
