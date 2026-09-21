import { describe, expect, it, vi, beforeEach } from 'vitest'
import { App } from '../../src/renderer/App'
import { render } from 'preact'
import { mount, click, input } from '../helpers/preact'
import type { CourseTreeInfo, SeuSummaryBridge } from '../../src/shared/bridge'
import type { ApiResult } from '../../src/shared/api-result'
import type { Note } from '../../src/shared/notes/schema'
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

/** 批3 (P1): 一个能过渲染层的最小笔记（封面回填用例只需 masthead 出现）。 */
const COVER_NOTE: Note = {
  chapters: [],
  quotes: [],
  overview: '本讲介绍复杂度分析。',
  knowledgeTree: { title: '复杂度', children: [{ title: 'O(n)', children: [] }] },
  timeline: [{ at: 65, title: '引入', detail: '开始讲解', refs: [], evidence: [] }],
  concepts: [{ term: '大O', definition: '渐进上界', refs: [] }],
  formulasAndSteps: [],
  methodology: '先定义后举例。',
  examCues: ['必考：复杂度计算'],
  questionsAndGaps: ['如何分析递归复杂度？'],
  quiz: [],
  conceptLinks: [],
  transcriptRefs: [],
  evidence: []
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
    // 批2 (plan 2026-09-20, P7): notes:latest 取到笔记时是 { note, transcriptHitRate }
    // 两支形态——裸 Note 会让 loadNote 解包出 undefined，本用例的笔记页永不出现。
    ;(bridge.notes.latest as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({
        note: {
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
        },
        transcriptHitRate: null
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

  // 批4 (plan 2026-09-20, P9/D5): 「我的学习」全屏展开——入口键挂在标题旁，
  // Ctrl+M 同款开关；选课时先选中再关闭（弹层挡着笔记页，「选了没反应」最坏）。
  it('批4 (P9/D5): 我的学习可全屏展开（入口键 / Ctrl+M），选课时关闭并落到该课时', async () => {
    const bridge = makeBridge()
    fakeState.courses = [{ id: 'c1', name: '数据结构', isMine: true, lessons: [{ id: 'l1', title: '第1讲', hasNote: false }] }]
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')

    click(host.querySelector('[data-testid="my-study-open"]'))
    await waitForSelector('[data-testid="my-study-dialog"]')
    expect(host.querySelector('[data-testid="my-study-dialog"]')?.getAttribute('aria-label')).toBe('我的学习')

    // Ctrl+M 是同款开关（关 → 开）。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }))
    await waitForGone('[data-testid="my-study-dialog"]')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }))
    await waitForSelector('[data-testid="my-study-dialog"]')

    // 展开课程 → 点课时：弹层关闭，且该课时真的被选中（qa:history 在选择路径上）。
    const dialog = host.querySelector('[data-testid="my-study-dialog"]') as HTMLElement
    click(dialog.querySelector('.course-head'))
    await vi.waitFor(() => {
      if (dialog.querySelector('.lesson-row') == null) throw new Error('waiting for lesson row')
    })
    click(dialog.querySelector('.lesson-row'))
    await waitForGone('[data-testid="my-study-dialog"]')
    await vi.waitFor(() => {
      expect(bridge.qa.history).toHaveBeenCalledWith('l1')
    })
  })

  // 批1 (plan 2026-09-20, P13): 三个自绘 overlay 同为 z-index 40，层级相同时由
  // DOM 顺序决定——浏览器整体返回 null 之前一直盖在课程导图弹层上，用户点
  // 「导图」看不到任何可见反应（弹层既看不见也点不着）。
  it('批1 (P13): 全屏浏览器里点课程卡「导图」→ 浏览器关闭、地图弹层可见、Esc 只关一层', async () => {
    const bridge = makeBridge()
    bridge.notes.courseTree = vi.fn(async () => ok({ tree: { title: '数据结构', children: [{ title: '第1讲', children: [] }] }, lessons: 1, skipped: 0 }))
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    click(host.querySelector('[data-testid="course-browser-open"]'))
    await waitForSelector('[data-testid="course-browser"]')

    const mapKey = host.querySelector<HTMLButtonElement>('[data-testid="course-browser"] button[aria-label^="查看课程导图"]')
    expect(mapKey).not.toBeNull()
    click(mapKey)

    await waitForSelector('[data-testid="course-map-dialog"]')
    // 浏览器先关：遮罩随之消失，导图弹层才是唯一在屏的一层。
    await waitForGone('[data-testid="course-browser"]')
    expect(bridge.notes.courseTree).toHaveBeenCalledWith('c1')
    // 「只剩一层」是可量的前提——否则下面的 Esc 断言分不清「关一层」与「关两层」。
    expect(host.querySelectorAll('.course-browser-overlay, .course-map-overlay, .bili-dialog-overlay, .fullscreen-overlay')).toHaveLength(1)

    // Esc 只关地图这一层——浏览器不会「跟着一起被关」（它已经关了，也不会回来）。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitForGone('[data-testid="course-map-dialog"]')
    expect(host.querySelector('[data-testid="course-browser"]')).toBeNull()
  })

  // 批1 (P13) 的防御性半边：地图弹层现在渲染在浏览器之后，任何「浏览器开着
  // 打开地图」的路径都盖在上面而不是被埋掉。
  it('批1 (P13): 地图弹层渲染在浏览器之后——两层同在时一次 Esc 只关最上面那一层', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    const sidebarMapKey = host.querySelector<HTMLButtonElement>('.sidebar button[aria-label^="查看课程导图"]')
    expect(sidebarMapKey).not.toBeNull()
    click(sidebarMapKey)
    await waitForSelector('[data-testid="course-map-dialog"]')

    click(host.querySelector('[data-testid="course-browser-open"]'))
    await waitForSelector('[data-testid="course-browser"]')
    const overlays = [...host.querySelectorAll('.course-browser-overlay, .course-map-overlay')]
    expect(overlays.map((el) => el.className)).toEqual(['course-browser-overlay', 'course-map-overlay'])

    // 批1 补口（验收项「Esc 只关一层」）：两层同开时，一次 Esc 关掉的只有**最上面
    // 那一层**（地图渲染在浏览器之后 = DOM 后者居上）。旧断言是「一次 Esc 两层全关」，
    // 与验收项字面相反，且这条路径真实可达（侧栏「查看课程导图」+ Ctrl+K/侧栏入口）。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitForGone('[data-testid="course-map-dialog"]')
    expect(host.querySelector('[data-testid="course-browser"]')).not.toBeNull()
    expect(host.querySelectorAll('.course-browser-overlay, .course-map-overlay, .bili-dialog-overlay, .fullscreen-overlay')).toHaveLength(1)

    // 第二层要再按一次才关；收尾理由同旧注释——helpers/preact 的 afterEach 只清
    // DOM，挂着不关会把 window 键监听与 body 滚动锁留给下一个用例。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
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
    // 批4 a11y: 与 MindMap 搜索框同款——读屏用户听到的是「搜索课程」而非「编辑框」。
    expect(box!.getAttribute('aria-label')).toBe('搜索课程')
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
    // CI 慢时序下 mount 的 200ms 去抖刷新可能晚于对话框交互才落——先等在途刷新
    // 静止（250ms 无新调用）再取基线，否则基线少算、把在途刷新误判成「多刷」。
    await vi.waitFor(async () => {
      const seen = listMock.mock.calls.length
      await new Promise((r) => setTimeout(r, 250))
      expect(listMock.mock.calls.length).toBe(seen)
    })
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

  it('批2 (P17): 「升级旧笔记」连点只发起一次课程体检；在途时按钮禁用并读「读取中…」', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' }
    )
    const bridge = makeBridge()
    // 体检请求挂着不返回——量「在途」这一窗口里的按钮与守卫。
    const healthGate: { settle?: () => void } = {}
    ;(bridge.notes.courseHealth as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          healthGate.settle = () =>
            resolve(ok([{ lessonId: 'l1', lessonTitle: '第一讲', version: 1, warnCount: 2, grade: 'weak', promptVersion: 0 }]))
        })
    )
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-library')
    const upgradeBtn = (): HTMLButtonElement =>
      [...host.querySelectorAll('button')].find((b) => b.textContent === '升级旧笔记' || b.textContent === '读取中…') as HTMLButtonElement
    // 连点两次（同一 tick）——第二次落在按钮还没被禁用之前，靠 hook 侧 in-flight 守卫拦下。
    click(upgradeBtn())
    click(upgradeBtn())
    await vi.waitFor(() => {
      expect(bridge.notes.courseHealth).toHaveBeenCalledTimes(1)
    })
    // 在途：文案加省略号 + disabled（busy 三件套，与同排「导出 Obsidian」同款）。
    const busy = upgradeBtn()
    expect(busy.textContent).toBe('读取中…')
    expect(busy.disabled).toBe(true)
    // 在途期间再点一次（同 task-panel 的「连点不出第二个 IPC」口径）。
    click(busy)
    await new Promise((r) => setTimeout(r, 50))
    expect(bridge.notes.courseHealth).toHaveBeenCalledTimes(1)
    // 体检落地后按钮复位，可再次打开。
    healthGate.settle?.()
    await waitForSelector('.note-upgrade-list')
    await vi.waitFor(() => {
      expect(upgradeBtn().textContent).toBe('升级旧笔记')
    })
    expect(upgradeBtn().disabled).toBe(false)
  })

  it('批2 (P4): 批量升级把每课失败原因显示在行内，toast 也带上第一条原因', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' },
      { lessonId: 'l2', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第二讲' }
    )
    const bridge = makeBridge()
    ;(bridge.notes.courseHealth as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([
        { lessonId: 'l1', lessonTitle: '第一讲', version: 1, warnCount: 2, grade: 'weak', promptVersion: 0 },
        { lessonId: 'l2', lessonTitle: '第二讲', version: 1, warnCount: 3, grade: 'weak', promptVersion: 0 }
      ])
    )
    // 一个成功、一个失败（main 侧守卫的原文，此前被整段丢弃）。
    ;(bridge.notes.regenerate as ReturnType<typeof vi.fn>).mockImplementation(async (lessonId: string) =>
      lessonId === 'l2'
        ? { ok: false, error: '任务运行中，请等待完成后再重新生成笔记' }
        : ok({ version: 2, images: 0, hitRate: { hits: 0, total: 0 } })
    )
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-library')
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '升级旧笔记') ?? null)
    await waitForSelector('.note-upgrade-list')
    await vi.waitFor(() => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选'))
      expect(btn?.textContent).toContain('（2）')
    })
    click([...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选')) ?? null)
    await vi.waitFor(() => {
      expect(bridge.notes.regenerate).toHaveBeenCalledTimes(2)
    })
    await vi.waitFor(() => {
      expect(host.querySelector('.note-upgrade-reason')).not.toBeNull()
    })
    // 行内原因 = 该课时自己的 res.error（不是一句「失败」）。
    const reasons = [...host.querySelectorAll('.note-upgrade-reason')].map((el) => el.textContent ?? '')
    expect(reasons).toEqual(['任务运行中，请等待完成后再重新生成笔记'])
    // toast 汇总第一条原因（其余引导到各行）。
    await vi.waitFor(() => {
      const toast = host.querySelector('.toast')?.textContent ?? ''
      expect(toast).toContain('1 个课时失败：任务运行中，请等待完成后再重新生成笔记')
    })
  })

  it('批3 (P23): 整课导出失败时 toast 报篇数与原因（不再只说「跳过 N 篇」）', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' }
    )
    const bridge = makeBridge()
    // 版权提醒已免除（本用例只关心导出结果的话术）。
    fakeState.copyrightNoticeOptOut = true
    ;(bridge.notes.exportCourseObsidian as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({
        canceled: false,
        exported: 1,
        skipped: 4,
        failures: [
          { lessonId: 'l2', reason: 'EISDIR: illegal operation on a directory' },
          { lessonId: 'l3', reason: 'EPERM: operation not permitted' },
          { lessonId: 'l4', reason: '第三条原因不该挤进 toast' }
        ]
      })
    )
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-library')
    click([...host.querySelectorAll('.note-library-group-head button')].find((b) => b.textContent === '导出 Obsidian') ?? null)
    await vi.waitFor(() => {
      const toast = host.querySelector('.toast')?.textContent ?? ''
      expect(toast).toContain('导出 1 篇')
    })
    const toast = host.querySelector('.toast')?.textContent ?? ''
    expect(toast).toContain('3 篇失败')
    // 前两条原因进 toast，其余引导到日志（逐条落日志在 ipc 用例里钉）。
    expect(toast).toContain('EISDIR')
    expect(toast).toContain('EPERM')
    expect(toast).not.toContain('第三条原因不该挤进 toast')
    expect(toast).toContain('详见日志')
    // 4 篇 skipped 里 3 篇是失败、1 篇是真无笔记——两者分开说。
    expect(toast).toContain('另有 1 个课时无笔记')
    expect(toast).not.toContain('无笔记已跳过')
    // 等这条 info toast 自动过期（3.5s）再结束用例——测试环境不 unmount 组件
    // （tests/helpers/preact.ts 只清 body），留着的自动消失定时器会在环境拆除
    // 之后触发一次渲染，preact 的 rAF 那时已不存在（vitest 报 unhandled rejection）。
    await vi.waitFor(
      () => {
        expect(host.querySelector('.toast')).toBeNull()
      },
      { timeout: 6000, interval: 100 }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it('批3 (P1): B 站课时「重新获取封面」——在途禁用、连点只发一次、成功后刷新封面', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '数据结构', teacher: '汪海', lessonTitle: '第1讲' }
    )
    const bridge = makeBridge()
    // 课程树要在 makeBridge 之后注入（makeBridge 会 resetFakeState）——来源 bilibili
    // 才给「重新获取封面」入口。
    fakeState.courses = [{ id: 'c1', name: '数据结构', source: 'bilibili', lessons: [{ id: 'l1', title: '第1讲', hasNote: true }] }]
    ;(bridge.notes as unknown as { latest: unknown }).latest = vi.fn(async () => ok({ note: COVER_NOTE, transcriptHitRate: null }))
    // 第一次取封面（loadNote 那条路径）无封面，回填之后能读到新图。
    let coverReads = 0
    ;(bridge.notes as unknown as { cover: unknown }).cover = vi.fn(async () => {
      coverReads += 1
      return ok(coverReads > 1 ? 'data:image/jpeg;base64,Y292ZXI=' : null)
    })
    // 回填请求挂着不返回——量「在途」这一窗口里的按钮与守卫。
    const gate: { settle?: () => void } = {}
    const backfill = vi.fn(
      () =>
        new Promise((resolve) => {
          gate.settle = () => resolve(ok({ coverPath: 'attachments/l1/cover.jpg' }))
        })
    )
    ;(bridge.notes as unknown as { backfillCover: unknown }).backfillCover = backfill
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-masthead')
    const button = (): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>('.note-cover-backfill')
    expect(button()?.textContent).toBe('重新获取封面')
    expect(button()?.disabled).toBe(false)
    // 连点两次（同一 tick）——第二次落在按钮被禁用之前，靠 hook 侧 in-flight 守卫拦下。
    click(button())
    click(button())
    await vi.waitFor(() => expect(backfill).toHaveBeenCalledTimes(1))
    expect(button()?.textContent).toBe('获取中…')
    expect(button()?.disabled).toBe(true)
    gate.settle?.()
    // 成功后刷新封面（走与 loadNote 同一条 refreshCover 路径），入口随之消失。
    await vi.waitFor(() => {
      expect(host.querySelector('.note-cover')?.getAttribute('src')).toBe('data:image/jpeg;base64,Y292ZXI=')
    })
    expect(button()).toBeNull()
    await vi.waitFor(() => expect(host.querySelector('.toast')?.textContent).toContain('已重新获取封面'))
    // 等 toast 自动过期再结束（同上面的收尾理由）。
    await vi.waitFor(
      () => {
        expect(host.querySelector('.toast')).toBeNull()
      },
      { timeout: 6000, interval: 100 }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  // 批2 二次评审点名：渲染层的补全路径（use-notes-domain 的 repairNote）此前
  // 没有任何用例——toast 两条分支、in-flight 守卫、成功后的刷新全靠 IPC 层代理
  // 条件断言，文案改坏了也没人知道。这里走真实点击：体检面板 → 「按体检结果补全」。
  it('批2 订正 (P2): 补全成功 → toast 说「体检 N 项 → M 项」、连点只发一次、笔记刷新', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第1讲' }
    )
    const bridge = makeBridge()
    // 当前笔记要能加载出来（体检面板才在）——换掉 latest 的桩，直接读新 mock 的调用数。
    const latest = vi.fn(async () => ok({ note: COVER_NOTE, transcriptHitRate: null }))
    ;(bridge.notes as unknown as { latest: unknown }).latest = latest
    // 补全请求挂着不返回——量「在途」这一窗口里的守卫。
    const gate: { settle?: () => void } = {}
    const repair = vi.fn(
      () =>
        new Promise((resolve) => {
          gate.settle = () => resolve(ok({ version: 2, repaired: true, health: { warnCount: 0, grade: 'good' as const, warnCountBeforeRepair: 2 }, transcriptHitRate: null }))
        })
    )
    ;(bridge.notes as unknown as { repair: unknown }).repair = repair
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-masthead')
    const latestBefore = latest.mock.calls.length
    click(host.querySelector('.note-health-toggle'))
    const repairBtn = (): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>('.note-repair-btn')
    expect(repairBtn()).not.toBeNull()
    // 同一 tick 连点两次：第二次落在按钮 disabled 之前，靠 hook 的 ref 守卫拦下。
    click(repairBtn())
    click(repairBtn())
    await vi.waitFor(() => expect(repair).toHaveBeenCalledTimes(1))
    expect(repairBtn()?.textContent).toBe('补全中…')
    expect(repairBtn()?.disabled).toBe(true)
    gate.settle?.()
    await vi.waitFor(() => expect(host.querySelector('.toast')?.textContent).toContain('已补全：体检 2 项 → 0 项'))
    // 成功后刷新当前笔记（否则屏幕停在补全前的旧版本与旧徽标）。
    await vi.waitFor(() => expect(latest.mock.calls.length).toBe(latestBefore + 1))
    // 在途守卫放开，按钮回到可点。
    await vi.waitFor(() => expect(repairBtn()?.disabled).toBe(false))
    // 等 toast 自动过期再结束（helpers/preact 的 afterEach 不 unmount，理由同批3）。
    await vi.waitFor(
      () => {
        expect(host.querySelector('.toast')).toBeNull()
      },
      { timeout: 6000, interval: 100 }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it('批2 订正 (P2): 未改善 → toast 明说保留原稿（不说「N 项 → M 项」）', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第1讲' }
    )
    const bridge = makeBridge()
    ;(bridge.notes as unknown as { latest: unknown }).latest = vi.fn(async () => ok({ note: COVER_NOTE, transcriptHitRate: null }))
    // 假桥默认的 repair 就是「未采纳」那一支：repaired false + warnCountBeforeRepair null。
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-masthead')
    click(host.querySelector('.note-health-toggle'))
    click(host.querySelector('.note-repair-btn'))
    await vi.waitFor(() => expect(host.querySelector('.toast')?.textContent).toBe('补完没有改善，已保留原稿'))
    expect(bridge.notes.repair).toHaveBeenCalledTimes(1)
    await vi.waitFor(
      () => {
        expect(host.querySelector('.toast')).toBeNull()
      },
      { timeout: 6000, interval: 100 }
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it('批2 (P5): 批量升级成功的是当前课时时刷新当前笔记，且笔记库仍只刷一次', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第1讲' }
    )
    const bridge = makeBridge()
    ;(bridge.notes.courseHealth as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([{ lessonId: 'l1', lessonTitle: '第1讲', version: 1, warnCount: 2, grade: 'weak', promptVersion: 0 }])
    )
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-library')
    const latestMock = bridge.notes.latest as unknown as { mock: { calls: unknown[][] } }
    const listMock = bridge.notes.list as unknown as { mock: { calls: unknown[][] } }
    const latestBefore = latestMock.mock.calls.length
    // CI 慢时序：先等在途刷新静止再取基线（同批4 的既有守卫）。
    await vi.waitFor(async () => {
      const seen = listMock.mock.calls.length
      await new Promise((r) => setTimeout(r, 250))
      expect(listMock.mock.calls.length).toBe(seen)
    })
    const listBefore = listMock.mock.calls.length
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '升级旧笔记') ?? null)
    await waitForSelector('.note-upgrade-list')
    await vi.waitFor(() => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选'))
      expect(btn?.textContent).toContain('（1）')
    })
    click([...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选')) ?? null)
    await vi.waitFor(() => {
      expect(bridge.notes.regenerate).toHaveBeenCalledTimes(1)
    })
    // P5: 被升级的正是当前课时 → 重新拉一次笔记（否则屏幕停在旧版本与旧徽标）。
    await vi.waitFor(() => {
      expect(latestMock.mock.calls.length).toBe(latestBefore + 1)
    })
    expect(latestMock.mock.calls.at(-1)?.[0]).toBe('l1')
    // 刷库仍只有一次（逐课刷全库是 N 倍开销——P5 没有把它变成第二次）。
    await vi.waitFor(() => {
      expect(listMock.mock.calls.length).toBe(listBefore + 1)
    })
    expect(listMock.mock.calls.length).toBe(listBefore + 1)
  })

  it('批2 (P6): 重试只跑未完成的课时——已成功的课时不再进确认载荷', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' },
      { lessonId: 'l2', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第二讲' }
    )
    const bridge = makeBridge()
    ;(bridge.notes.courseHealth as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([
        { lessonId: 'l1', lessonTitle: '第一讲', version: 1, warnCount: 2, grade: 'weak', promptVersion: 0 },
        { lessonId: 'l2', lessonTitle: '第二讲', version: 1, warnCount: 3, grade: 'weak', promptVersion: 0 }
      ])
    )
    const regenerateMock = bridge.notes.regenerate as ReturnType<typeof vi.fn>
    // l2 第一次失败、第二次成功（显式计数，不依赖 mock.calls 的记账时机）。
    let l2Attempts = 0
    regenerateMock.mockImplementation(async (lessonId: string) => {
      if (lessonId === 'l2' && ++l2Attempts === 1) {
        return { ok: false, error: '该课时存在排队/运行中的任务，请等待完成后再重新生成笔记' }
      }
      return ok({ version: 2, images: 0, hitRate: { hits: 0, total: 0 } })
    })
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-library')
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '升级旧笔记') ?? null)
    await waitForSelector('.note-upgrade-list')
    await vi.waitFor(() => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选'))
      expect(btn?.textContent).toContain('（2）')
    })
    const confirm = (): HTMLButtonElement => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选')) as HTMLButtonElement
      click(btn)
      return btn
    }
    confirm()
    await vi.waitFor(() => {
      expect(regenerateMock).toHaveBeenCalledTimes(2)
    })
    await vi.waitFor(() => {
      expect(host.querySelector('.note-upgrade-reason')).not.toBeNull()
    })
    // 评审补口①：按钮计数必须等于**实际会跑**的数量——l1 已 ✓ 已升级被裁掉，
    // 所以是（1）而不是（2）。只把裁剪放在确认回调里会让计数撒谎。
    await vi.waitFor(() => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选'))
      expect(btn?.textContent).toBe('升级所选（1）')
    })
    // 第二次点「升级所选」：l1 已 ✓ 已升级 → 被裁掉；只有 l2 再跑一次。
    confirm()
    await vi.waitFor(() => {
      expect(regenerateMock).toHaveBeenCalledTimes(3)
    })
    expect(regenerateMock.mock.calls.filter((c) => c[0] === 'l1')).toHaveLength(1)
    expect(regenerateMock.mock.calls.filter((c) => c[0] === 'l2')).toHaveLength(2)
    // 评审补口②：全部已升级时按钮不能是「可点但点了没反应」的死角——
    // 计数归零、按钮禁用、并说明原因（重试载荷为空 → hook 早退 → 静默无反应）。
    await vi.waitFor(() => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选')) as HTMLButtonElement
      expect(btn.textContent).toBe('升级所选（0）')
      expect(btn.disabled).toBe(true)
    })
    expect(host.querySelector('.dialog-message')?.textContent).toContain('所选课时都已升级，无需重跑')
    const beforeIdleClick = regenerateMock.mock.calls.length
    confirm()
    await new Promise((r) => setTimeout(r, 50))
    expect(regenerateMock.mock.calls.length).toBe(beforeIdleClick)
  })

  it('批2 (P6 评审补口): 单课时升级成功后按钮归零并禁用，不再「写着（1）却点了没反应」', async () => {
    NOTE_ROWS.push(
      { lessonId: 'l1', version: 1, createdAt: '2026-09-20T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' }
    )
    const bridge = makeBridge()
    ;(bridge.notes.courseHealth as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok([{ lessonId: 'l1', lessonTitle: '第一讲', version: 1, warnCount: 2, grade: 'weak', promptVersion: 0 }])
    )
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('.note-library')
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '升级旧笔记') ?? null)
    await waitForSelector('.note-upgrade-list')
    await vi.waitFor(() => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选'))
      expect(btn?.textContent).toBe('升级所选（1）')
    })
    // 最常见路径：勾 1 课 → 升级成功 → 行显示「✓ 已升级」。
    click([...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选')) ?? null)
    await vi.waitFor(() => {
      expect(bridge.notes.regenerate).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(host.querySelector('.note-upgrade-row.done')).not.toBeNull()
    })
    // 缺陷复现点：此前的按钮仍是「升级所选（1）」且可点，点下去 onRun([]) 被
    // 静默吃掉——无 toast、无状态变化、弹层原样留着。
    await vi.waitFor(() => {
      const btn = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选')) as HTMLButtonElement
      expect(btn.textContent).toBe('升级所选（0）')
      expect(btn.disabled).toBe(true)
    })
    expect(host.querySelector('.dialog-message')?.textContent).toContain('所选课时都已升级，无需重跑')
    // 全选（含 done 项）也不会把按钮重新点活——runnable 永远是裁完的那一份。
    click(host.querySelector('.note-upgrade-all input'))
    await new Promise((r) => setTimeout(r, 20))
    const afterSelectAll = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent?.startsWith('升级所选')) as HTMLButtonElement
    expect(afterSelectAll.textContent).toBe('升级所选（0）')
    expect(afterSelectAll.disabled).toBe(true)
  })

  it('批4 a11y: 主 tab 内容面板补 role=tabpanel，与激活 tab 双向 aria 关联', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.app-shell')
    await waitForSelector('.task-panel')
    const panel = host.querySelector('[role="tabpanel"]')!
    expect(panel).not.toBeNull()
    const active = host.querySelector('.tabs button.active') as HTMLButtonElement
    expect(panel.getAttribute('aria-labelledby')).toBe(active.id)
    expect(active.getAttribute('aria-controls')).toBe(panel.id)
    // 切到「笔记」：面板与关联随行（tabpanel 只有一个，指向新激活 tab）。
    click([...host.querySelectorAll('.tabs button')].find((b) => b.textContent === '笔记') ?? null)
    await waitForSelector('[role="tabpanel"]')
    const panel2 = host.querySelector('[role="tabpanel"]')!
    const active2 = host.querySelector('.tabs button.active') as HTMLButtonElement
    expect(active2.textContent).toBe('笔记')
    expect(panel2.getAttribute('aria-labelledby')).toBe(active2.id)
  })
})
