import { describe, expect, it, vi, beforeEach } from 'vitest'
import { App } from '../../src/renderer/App'
import { render } from 'preact'
import { mount, click } from '../helpers/preact'
import type { SeuSummaryBridge } from '../../src/shared/bridge'
import { makeBridge, ok, fakeState } from '../helpers/fake-app-bridge'

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

describe('App shell (useAppState over a mocked bridge)', () => {
  beforeEach(() => {
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
})
