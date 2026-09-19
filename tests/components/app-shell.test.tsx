import { describe, expect, it, vi, beforeEach } from 'vitest'
import { App } from '../../src/renderer/App'
import { render } from 'preact'
import { mount, click, input } from '../helpers/preact'
import type { CourseTreeInfo, SeuSummaryBridge } from '../../src/shared/bridge'
import type { ApiResult } from '../../src/shared/api-result'
import { makeBridge, ok, fakeState, NOTE_ROWS, TASK_ROWS, setListTotals } from '../helpers/fake-app-bridge'

/**
 * App-shell integration over a mocked bridge: the useAppState state machine
 * (previously untested) — honest initial state, lesson selection wiring, and
 * the qa-history echo added in the 2026-09-02 combined audit.
 *
 * Preact flushes hook state updates outside act() on its own schedule, so
 * DOM assertions go through waitForSelector polling.
 */


async function waitForSelector(selector: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (document.querySelector(selector) == null) throw new Error(`waiting for ${selector}`)
    },
    { timeout: 3000, interval: 25 }
  )
}

async function waitForGone(selector: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (document.querySelector(selector) != null) throw new Error(`waiting for ${selector} to disappear`)
    },
    { timeout: 3000, interval: 25 }
  )
}

/** M2 批 A: 全部课程默认折叠——先展开组，课程行才存在于 DOM。 */
async function expandAllCourses(): Promise<void> {
  // 声明批2: 首启「使用须知」闸门要先读完 settings 才渲染外壳（boot 态没有侧栏），
  // 所以交互前必须先等外壳出现——这也是真实启动顺序。
  await waitForSelector('.app-shell')
  const toggle = document.querySelector('[data-testid="all-courses-toggle"]')
  if (toggle != null) click(toggle)
  await waitForSelector('.course-head')
}

async function selectFirstLesson(bridge: SeuSummaryBridge): Promise<void> {
  await expandAllCourses()
  if (document.querySelector('.lesson-row') == null) click(document.querySelector('.course-head'))
  await waitForSelector('.lesson-row')
  click(document.querySelector('.lesson-row'))
  await vi.waitFor(() => {
    expect(bridge.qa.history).toHaveBeenCalled()
  })
  // qa history render happens outside act(); poll for it.
  await new Promise((r) => setTimeout(r, 20))
}

/** The QaPanel lives on the third tab; switch there before asserting on it. */
function openQaTab(host: HTMLElement): void {
  const tabs = Array.from(host.querySelectorAll('.tabs button'))
  click(tabs.find((b) => b.textContent === '追问') ?? null)
}

/**
 * 批5: 窄窗自动收侧栏按 matchMedia('(max-width: 1024px)') 判定。happy-dom 的默认
 * 视口落在窄侧，所以测试必须显式声明窗口宽度，否则每个用例都会撞上自动收起。
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

describe('App shell (useAppState over a mocked bridge)', () => {
  beforeEach(() => {
    setNarrowViewport(false)
    // 批C: 分页夹具是模块级的，用例之间必须复位（否则「显示更多」的计数会串）。
    NOTE_ROWS.length = 0
    TASK_ROWS.length = 0
    setListTotals(0, 0)
    document.body.innerHTML = ''
    // 批C: the app persists its UI snapshot in sessionStorage (2026-09-05:
    // moved from localStorage so a cold start lands on the clean home) —
    // tests must not inherit each other's selections/expanded state.
    window.sessionStorage.clear()
  })

  it('starts with an honest logged_out badge, four tabs, and the loaded tree', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    await waitForSelector('.course-head')
    expect(host.querySelector('[data-testid="session-badge"]')?.className).toContain('logged_out')
    expect(host.querySelectorAll('.tabs button')).toHaveLength(4)
    expect(bridge.school.session).toHaveBeenCalled()
    expect(bridge.school.courseTree).toHaveBeenCalled()
    // M2 批 A: 全部课程默认折叠，我的学习聚合区常驻。
    expect(host.querySelector('[data-testid="all-courses-toggle"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('我的学习')
  })

  it('cold start with an empty snapshot lands on the clean home (tasks tab, no lesson)', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    await waitForSelector('.course-head')
    const active = host.querySelector('.tabs button.active')
    expect(active?.textContent).toBe('任务')
    // No restored selection: no breadcrumb, no lesson-row highlighted.
    expect(host.querySelector('.crumbs')).toBeNull()
    expect(host.querySelector('.lesson-row.selected')).toBeNull()
  })

  it('restores the persisted lesson selection after a renderer reload (批C)', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    const saved = JSON.parse(window.sessionStorage.getItem('seu-summary.ui-state.v1') ?? '{}') as { currentLesson?: string }
    expect(saved.currentLesson).toBe('l1')
    // Reload: the fresh mount resumes the note/qa/history for that lesson.
    render(null, host)
    const reloaded = makeBridge()
    const host2 = mount(<App bridge={reloaded} />)
    await vi.waitFor(() => {
      expect(reloaded.notes.latest).toHaveBeenCalledWith('l1')
    })
    // The open group + expanded course come back from the persisted snapshot,
    // so the selected row is present without any clicks.
    await waitForSelector('.lesson-row.selected')
    expect(host2.querySelector('.lesson-row.selected')?.textContent).toContain('第1讲')
  })

  it('shows the welcome guide when the local tree is empty', async () => {
    const bridge = makeBridge()
    fakeState.courses = []
    mount(<App bridge={bridge} />)
    await waitForSelector('.welcome-guide')
  })

  it('批2: 零课程时主区承接三步引导，不再声称「从左侧课程树点击一个课时」', async () => {
    const bridge = makeBridge()
    fakeState.courses = []
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.welcome-guide-main')
    // 侧栏紧凑版 + 主区首启卡：同一份三步内容，两个落点。
    expect(host.querySelectorAll('.welcome-guide')).toHaveLength(2)
    expect(host.querySelectorAll('.guide-steps')).toHaveLength(2)
    // 负向红线：左侧一门课都没有时，主区不许再给「点左侧课程树」这种不成立的指引。
    expect(host.textContent).not.toContain('先选择课时')
    expect(host.textContent).not.toContain('从左侧课程树点击一个课时')
  })

  it('批C 批3: 点「显示更多」按页加长列表（不改主进程上限）', async () => {
    NOTE_ROWS.push({ lessonId: 'l1', version: 1, createdAt: '2026-09-08T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' })
    setListTotals(0, 431)
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    // 笔记库在「笔记」页签（应用默认落在任务页）。
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-library-search')
    // 首屏页 = 100（主进程默认上限 200 之下的一页）。
    const calls = (bridge.notes.list as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls[calls.length - 1]?.[0]).toMatchObject({ limit: 100 })

    click([...host.querySelectorAll('button')].find((b) => b.textContent?.includes('显示更多')) ?? null)
    await vi.waitFor(() => {
      const next = (bridge.notes.list as unknown as { mock: { calls: unknown[][] } }).mock.calls
      expect(next[next.length - 1]?.[0]).toMatchObject({ limit: 200 })
    })
  })

  it('批2: 一条任务都没有时不渲染「全部任务（最近 50 条）」标题', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.task-panel')
    expect(host.textContent).not.toContain('全部任务（最近 50 条）')
  })

  it('echoes recorded qa history for the selected lesson, oldest first', async () => {
    const bridge = makeBridge()
    fakeState.qaHistory = [
      { question: '第二问', answer: '答二' },
      { question: '第一问', answer: '答一' }
    ]
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    openQaTab(host)

    await waitForSelector('.qa-q')
    const questions = Array.from(document.querySelectorAll('.qa-q')).map((q) => q.textContent)
    expect(questions).toEqual(['第一问', '第二问'])
  })

  it('does not leak the previous lesson qa panel when the new one has no history', async () => {
    const bridge = makeBridge()
    fakeState.qaHistory = [{ question: '旧课时的问题', answer: '答' }]
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    openQaTab(host)
    await waitForSelector('.qa-q')

    // Re-select the same lesson with an emptied history: panel must clear.
    fakeState.qaHistory = []
    click(document.querySelector('.lesson-row'))
    await waitForGone('.qa-q')
  })

  it('blocks task creation until ASR+multimodal providers are bound, offering settings (批1 A1)', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    const run = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '创建并运行')
    click(run ?? null)
    await waitForSelector('.toast-error')
    expect(host.textContent).toContain('尚未绑定ASR 转写、多模态总结模型')
    expect(host.textContent).toContain('去设置')
    expect(bridge.tasks.create).not.toHaveBeenCalled()
  })

  it('creates the task once both capabilities are bound (批1 A1)', async () => {
    const bridge = makeBridge()
    ;(bridge.providers.list as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({ providers: [], bindings: [{ capability: 'asr', providerId: 'p', model: 'asr-m' }, { capability: 'multimodal', providerId: 'p', model: 'mm-m' }] })
    )
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    const run = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '创建并运行')
    click(run ?? null)
    await vi.waitFor(() => {
      expect(bridge.tasks.create).toHaveBeenCalled()
    })
  })

  it('lands on the notes tab for a processed lesson (批5 C9)', async () => {
    const bridge = makeBridge()
    fakeState.courses = [
      { id: 'c1', name: '数据结构', lessons: [{ id: 'l1', title: '第1讲', hasNote: true }] }
    ]
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    await waitForSelector('.course-head')
    click(document.querySelector('.course-head'))
    await waitForSelector('.lesson-row')
    click(document.querySelector('.lesson-row'))
    await vi.waitFor(() => {
      const active = host.querySelector('.tabs button.active')
      expect(active?.textContent).toBe('笔记')
    })
  })

  it('lands on the tasks tab for an unprocessed lesson (批5 C9)', async () => {
    // C9 persists the tab: reset so this mount starts from a clean slate.
    window.sessionStorage.clear()
    const bridge = makeBridge()
    fakeState.courses = [
      { id: 'c1', name: '数据结构', lessons: [{ id: 'l1', title: '第1讲', hasNote: false }] }
    ]
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    await waitForSelector('.course-head')
    click(document.querySelector('.course-head'))
    await waitForSelector('.lesson-row')
    click(document.querySelector('.lesson-row'))
    await vi.waitFor(() => {
      const active = host.querySelector('.tabs button.active')
      expect(active?.textContent).toBe('任务')
    })
  })

  it('brand home click drops the stale note: notes tab shows the empty state, not the old lesson (2026-09-05)', async () => {
    const bridge = makeBridge()
    ;(bridge.notes.latest as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({
        overview: '旧笔记概览',
        knowledgeTree: { title: '旧课', children: [] },
        timeline: [{ at: 10, title: '旧时间线', detail: 'x', refs: [], evidence: [] }],
        concepts: [],
        formulasAndSteps: [],
        methodology: '',
        examCues: [],
        questionsAndGaps: [],
        quiz: [],
        transcriptRefs: [],
        evidence: []
      })
    )
    fakeState.courses = [
      { id: 'c1', name: '数据结构', lessons: [{ id: 'l1', title: '第1讲', hasNote: true }] }
    ]
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    // The note body is on screen for the selected lesson.
    await waitForSelector('.note-section')
    expect(host.querySelectorAll('.note-toolbar').length).toBe(1)

    // Brand click = home: the note state must go with the lesson selection.
    click(host.querySelector('.brand'))
    const notesTab = Array.from(host.querySelectorAll('.tabs button')).find((b) => b.textContent === '笔记')
    click(notesTab ?? null)
    await waitForGone('.note-section')
    expect(host.querySelector('.note-toolbar')).toBeNull()
    expect(host.querySelector('.note-viewer .empty-state')).not.toBeNull()
    expect(host.textContent).not.toContain('旧笔记概览')
  })

  it('login flips the badge and logout clears the tree and qa panel', async () => {
    const bridge = makeBridge()
    fakeState.qaHistory = [{ question: '问', answer: '答' }]
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    click(document.querySelector('.course-head'))
    await waitForSelector('.lesson-row')

    // 批1 双源并列: the logged_out SEU badge IS the login affordance; B2
    // asks for a jump confirmation before the window becomes the school's page.
    click(host.querySelector('[data-testid="session-badge"]'))
    await waitForSelector('.dialog')
    const jump = Array.from(host.querySelectorAll('.dialog-actions button')).find((b) => b.textContent === '跳转')
    click(jump ?? null)
    await waitForSelector('[data-testid="session-badge"].logged_in')
    // The B站 badge sits in parallel and never triggers the CAS jump dialog.
    expect(document.querySelector('[data-testid="bili-session-badge"]')).not.toBeNull()

    // C4: logout also confirms first — click the logged-in badge.
    click(host.querySelector('[data-testid="session-badge"]'))
    await waitForSelector('.dialog')
    const logoutConfirm = Array.from(host.querySelectorAll('.dialog-actions button')).find((b) => b.textContent === '退出')
    click(logoutConfirm ?? null)
    await waitForSelector('[data-testid="session-badge"].logged_out')
    await waitForGone('.lesson-row')
    expect(bridge.school.logout).toHaveBeenCalled()
  })

  it('批1 双源并列: the sidebar B站 entry opens the import dialog, which re-checks the session', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    const openBtn = Array.from(host.querySelectorAll('.sidebar-head button')).find((b) => b.textContent === '导入 B站视频')
    expect(openBtn).not.toBeNull()
    click(openBtn ?? null)
    await waitForSelector('[data-testid="bili-import-dialog"]')
    // openBili re-reads the bilibili session so the badge is never stale.
    await vi.waitFor(() => {
      expect(bridge.bilibili.session).toHaveBeenCalled()
    })
    expect(document.querySelector('[data-testid="bili-account-row"]')?.textContent).toContain('B站·未登录')
    // Esc closes (same convention as the other dialogs).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitForGone('[data-testid="bili-import-dialog"]')
    expect(host.querySelector('.manual-fallback summary')?.textContent).toBe('高级：手动添加课程 ID')
  })

  it('批2 钉住: a failed progress event refreshes the task lists (failed rows update in place)', async () => {
    const bridge = makeBridge()
    const sink: { fire?: (p: { taskId: string; state: string; stage: string | null; message: string; percent: number }) => void } = {}
    ;(bridge.tasks.onProgress as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation((cb: (p: { taskId: string; state: string; stage: string | null; message: string; percent: number }) => void) => {
      sink.fire = cb
      return () => undefined
    })
    mount(<App bridge={bridge} />)
    await expandAllCourses()
    expect(bridge.tasks.list).toHaveBeenCalled()
    const listCalls = bridge.tasks.list as unknown as { mock: { calls: unknown[] } }
    const callsAfterMount = listCalls.mock.calls.length
    // The 存量 bug this pins: a terminal FAILURE used to leave the history
    // rows stale (old active state + a cancel button that then errored).
    sink.fire!({ taskId: 't-fail', state: 'failed', stage: 'downloading_video', message: '网络中断', percent: 30 })
    await vi.waitFor(() => {
      expect(listCalls.mock.calls.length).toBeGreaterThan(callsAfterMount)
    })
    // 批2: the failed card is visible in the global (no-lesson) view too.
    await waitForSelector('[data-testid="task-status"]')
  })

  it('健康巡查 2026-09-12: a catalog-harvest rejection toasts in the originating session', async () => {
    // Regression: the err envelope used to vanish behind .catch(() => undefined) —
    // the user saw one 3.5s «请稍候» toast and nothing else, with no badge and
    // a re-clickable button.
    window.localStorage.setItem('seu-summary.jump-confirm.skip', '1')
    const bridge = makeBridge()
    fakeState.courses = [{ id: 'c9', name: '空课', lessons: [] }]
    ;(bridge.school.harvestLessons as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      async () => ({ ok: false, error: '课程缺少录播课时标识' })
    )
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    click(document.querySelector('.course-head'))
    await waitForSelector('.lesson-row.empty')
    click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '抓取课时目录') ?? null)
    await waitForSelector('.toast-error')
    expect(document.querySelector('.toast-error')?.textContent).toContain('课程缺少录播课时标识')
    // The optimistic inflight badge cleared — the button is back (re-pickable
    // after fixing the cause, not re-clickable DURING a phantom harvest).
    await vi.waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '抓取课时目录')
      ).not.toBeNull()
    })
    expect(host).toBeTruthy()
  })

  it('批5: 窄窗（≤1024）挂载时侧栏默认收起，把宽度让给内容列', async () => {
    setNarrowViewport(true)
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    expect(host.querySelector('aside.sidebar')?.className).toContain('collapsed')
    // 手动展开仍然有效（自动收起只在挂载时判定一次）。
    click(host.querySelector('.sidebar-collapse'))
    await vi.waitFor(() => expect(host.querySelector('aside.sidebar')?.className).not.toContain('collapsed'))
  })

  it('健康巡查 2026-09-12 批8: the sidebar collapses and the choice survives a reload', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    const toggle = host.querySelector('.sidebar-collapse') as HTMLButtonElement
    expect(toggle).not.toBeNull()
    // 批1 (plan 2026-09-13): the toggle lives IN the header row (one row with
    // «课程» and the actions), not on its own line above them.
    expect(toggle.closest('.sidebar-head')).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const aside = host.querySelector('aside.sidebar')!
    expect(aside.className).not.toContain('collapsed')

    click(toggle)
    await vi.waitFor(() => expect(aside.className).toContain('collapsed'))
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const saved = JSON.parse(window.sessionStorage.getItem('seu-summary.ui-state.v1') ?? '{}') as { sidebarCollapsed?: boolean }
    expect(saved.sidebarCollapsed).toBe(true)

    // Reload (harvest/login navigation): the collapsed rail comes back.
    render(null, host)
    const reloaded = mount(<App bridge={makeBridge()} />)
    await waitForSelector('.app-shell')
    const reloadedAside = reloaded.querySelector('aside.sidebar')!
    expect(reloadedAside.className).toContain('collapsed')
    click(reloaded.querySelector('.sidebar-collapse'))
    await vi.waitFor(() => expect(reloadedAside.className).not.toContain('collapsed'))
  })

  it('批1 (plan 2026-09-13): 刷新中 keeps a fixed-width label and the page progress lives in the meta line', async () => {
    const bridge = makeBridge()
    bridge.school.session = vi.fn(async () => ok({ state: 'logged_in' as const }))
    type ListValue = { loaded: number; platformTotal: number; platformPages: number }
    let releaseList!: (value: ApiResult<ListValue>) => void
    bridge.school.listCourses = vi.fn(
      () => new Promise<ApiResult<ListValue>>((resolve) => { releaseList = resolve })
    )
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    const refreshBtn = [...host.querySelectorAll('.sidebar-head button')].find((b) => b.textContent === '刷新课程')
    expect(refreshBtn).not.toBeUndefined()
    click(refreshBtn!)
    // D2: the busy label is one fixed string — the old «刷新中 12/34 页…» made
    // the one-row header overflow (289px vs 269px) and clipped the toggle.
    await vi.waitFor(() => {
      const busy = [...host.querySelectorAll('.sidebar-head button')].find((b) => b.textContent === '刷新中…')
      expect(busy).not.toBeUndefined()
      expect(busy?.hasAttribute('disabled')).toBe(true)
    })
    // The meta line shows up DURING the refresh (it used to need a finished
    // one) and carries the page progress + the local-catalog count.
    await waitForSelector('[data-testid="tree-meta"]')
    expect(host.querySelector('[data-testid="tree-meta"]')?.textContent).toContain('正在刷新')
    expect(host.querySelector('[data-testid="tree-meta"]')?.textContent).toContain('本地已收录')

    releaseList(ok({ loaded: 12, platformTotal: 500, platformPages: 5 }))
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="tree-meta"]')?.textContent).toContain('本次刷新 12 门')
    })
    // A4: three numbers, three honest labels — never «已加载 0 门 / 全校约 500 门».
    const line = host.querySelector('[data-testid="tree-meta"]')?.textContent ?? ''
    expect(line).toContain('本地已收录')
    expect(line).toContain('平台列表约 500 门')
    expect(line).not.toContain('全校约')
    expect(line).toContain('搜索只查本地已收录的课')
    expect(refreshBtn?.textContent).toBe('刷新课程')
  })

  it('批1 (plan 2026-09-13): a refresh that yields 0 courses states it and points at re-login instead of conflating counts', async () => {
    const bridge = makeBridge()
    bridge.school.session = vi.fn(async () => ok({ state: 'logged_in' as const }))
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    const refreshBtn = [...host.querySelectorAll('.sidebar-head button')].find((b) => b.textContent === '刷新课程')
    click(refreshBtn!)
    // The busy line also matches [data-testid=tree-meta]; wait for the
    // finished-refresh wording, not just the element.
    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="tree-meta"]')?.textContent).toContain('本次刷新 0 门')
    })
    const line = host.querySelector('[data-testid="tree-meta"]')?.textContent ?? ''
    expect(line).toContain('平台返回了空列表')
    expect(line).toContain('本地已收录')
    expect(line).not.toContain('全校约')
  })

  it('批4 (plan 2026-09-13): the «全部课程» row opens the fullscreen browser and Ctrl+K closes it', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    click(host.querySelector('[data-testid="course-browser-open"]'))
    await waitForSelector('[data-testid="course-browser"]')
    expect(host.querySelector('[data-testid="course-browser"]')?.textContent).toContain('全部课程')
    expect(host.querySelector('[data-testid="course-browser-meta"]')?.textContent).toContain('本地已收录')
    // D6-A: Ctrl+K toggles the browser back closed (the chord is free).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await waitForGone('[data-testid="course-browser"]')
  })

  it('批4: 搜索态也分块——≥150 门命中只渲染 150 行，「显示更多」按页加长（重置 effect 对搜索态生效）', async () => {
    const courses: CourseTreeInfo[] = Array.from({ length: 260 }, (_, i) => ({
      id: `s${i}`,
      name: `检索课程${i}`,
      lessons: [{ id: `s${i}-l1`, title: `第${i}讲`, hasNote: false }]
    }))
    const bridge = makeBridge()
    // fixture 语义：makeBridge 会复位 fakeState，courses 必须在它之后赋值。
    fakeState.courses = courses
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    await waitForSelector('.sidebar .search-input')
    const box = host.querySelector<HTMLInputElement>('.sidebar .search-input')
    expect(box).not.toBeNull()
    input(box, '检索课程')
    // 300ms 防抖后侧栏切到纯搜索结果列表。
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.course-head')!.length).toBeGreaterThan(0)
    })
    // 防抖渲染与 effect flush 落定后再操作——Preact act 与 debounce 的
    // 渲染队列有竞态，紧接着点「显示更多」会丢掉这次状态更新。
    await new Promise((r) => setTimeout(r, 100))
    // 分块：260 门命中只渲染 150 行（等量 lesson 行随之裁掉）。
    expect(document.querySelectorAll('.course-head')!.length).toBe(150)
    const more = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('显示更多'))
    expect(more).not.toBeUndefined()
    expect(more?.textContent).toContain('还有 110 门')
    click(more ?? null)
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.course-head')!.length).toBe(260)
    })
    // 取满后「显示更多」消失，不留一个「还有 0 门」。
    expect([...document.querySelectorAll('button')].some((b) => b.textContent?.includes('显示更多'))).toBe(false)
  })

  it('批4: 启动只拉一次任务列表，口径与「显示更多」分页一致（不再混入全表二次覆盖）', async () => {
    const bridge = makeBridge()
    mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    await vi.waitFor(() => {
      expect(bridge.tasks.list).toHaveBeenCalled()
    })
    const listCalls = bridge.tasks.list as unknown as { mock: { calls: unknown[][] } }
    await vi.waitFor(() => {
      expect(listCalls.mock.calls.length).toBe(1)
    })
    expect(listCalls.mock.calls[0]?.[1]).toMatchObject({ limit: 50 })
  })

  it('批4: 存量升级批量完成后只刷一次笔记库（不再逐课刷全库）', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-08T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' },
      { lessonId: 'l2', version: 1, createdAt: '2026-09-08T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第二讲' }
    )
    const bridge = makeBridge()
    ;(bridge.notes.courseHealth as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([
        { lessonId: 'l1', lessonTitle: '第一讲', version: 1, warnCount: 2, grade: 'weak', promptVersion: 0 },
        { lessonId: 'l2', lessonTitle: '第二讲', version: 1, warnCount: 0, grade: 'good', promptVersion: 0 }
      ])
    )
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-library')
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '升级旧笔记') ?? null)
    await waitForSelector('.dialog')
    // 等 courseHealth 落地（loading 结束才有列表与可点的确认钮）。
    await waitForSelector('.note-upgrade-list')
    // 等默认勾选的 effect flush 落定（确认钮随之可用——同上，渲染队列竞态）。
    await vi.waitFor(() => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选'))
      expect(btn?.textContent).toContain('（2）')
    })
    const confirm = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选')) as HTMLButtonElement
    expect(confirm).not.toBeUndefined()
    const listMock = bridge.notes.list as unknown as { mock: { calls: unknown[][] } }
    const before = listMock.mock.calls.length
    click(confirm)
    await vi.waitFor(() => {
      expect(bridge.notes.regenerate).toHaveBeenCalledTimes(2)
    })
    await vi.waitFor(() => {
      expect(host.textContent).toContain('已升级 2 个课时笔记')
    })
    // 批量后刷一次——逐课刷会是 2 次。
    expect(listMock.mock.calls.length).toBe(before + 1)
  })
})
