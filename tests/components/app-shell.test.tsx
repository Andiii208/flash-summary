import { describe, expect, it, vi, beforeEach } from 'vitest'
import { App } from '../../src/renderer/app'
import { render } from 'preact'
import { mount, click } from '../helpers/preact'
import type { SeuSummaryBridge, CourseTreeInfo, TaskRowInfo, ProvidersListResult, AppSettingsInfo } from '../../src/shared/bridge'
import type { ApiResult } from '../../src/shared/api-result'

/**
 * App-shell integration over a mocked bridge: the useAppState state machine
 * (previously untested) — honest initial state, lesson selection wiring, and
 * the qa-history echo added in the 2026-09-02 combined audit.
 *
 * Preact flushes hook state updates outside act() on its own schedule, so
 * DOM assertions go through waitForSelector polling.
 */

const TREE: CourseTreeInfo[] = [
  { id: 'c1', name: '数据结构', lessons: [{ id: 'l1', title: '第1讲', hasNote: false }] }
]

function ok<T>(value: T): ApiResult<T> {
  return { ok: true, value }
}

let courseTreeRows: CourseTreeInfo[]
let qaHistoryRows: Array<{ question: string; answer: string }>

function makeBridge(): SeuSummaryBridge {
  courseTreeRows = TREE
  qaHistoryRows = []
  return {
    school: {
      login: vi.fn(async () => ok({ state: 'logged_in' })),
      logout: vi.fn(async () => ok({ state: 'logged_out' })),
      session: vi.fn(async () => ok({ state: 'logged_out' })),
      listCourses: vi.fn(async () => ok({ loaded: 0, platformTotal: 0, platformPages: 1 })),
      addManualCourse: vi.fn(async () => ok({ courseId: 'c', lessonId: 'l' })),
      courseTree: vi.fn(async () => ok(courseTreeRows)),
      harvestLessons: vi.fn(async () => ok({ lessons: 0 })),
      harvestState: vi.fn(async () => ok({ inflight: [], outcome: null })),
      netCheck: vi.fn(async () => ok({ intercepted: false, resolved: [] })),
      setMine: vi.fn(async () => ok(true)),
      onRefreshProgress: vi.fn(() => () => undefined)
    },
    providers: {
      list: vi.fn(async (): Promise<ApiResult<ProvidersListResult>> => ok({ providers: [], bindings: [] })),
      save: vi.fn(async () => ok({ id: 'p', hasKey: true })),
      remove: vi.fn(async () => ok(true)),
      bind: vi.fn(async () => ok(true)),
      test: vi.fn(async () => ok({ latencyMs: 12, answer: 'ok' }))
    },
    tasks: {
      create: vi.fn(async () => ok({ id: 't1' })),
      list: vi.fn(async (): Promise<ApiResult<TaskRowInfo[]>> => ok([])),
      run: vi.fn(async () => ok({})),
      runAsync: vi.fn(async () => ok({ id: 't1', state: 'running' })),
      cancel: vi.fn(async () => ok({ cancelled: true })),
      onProgress: vi.fn(() => () => undefined)
    },
    notes: {
      latest: vi.fn(async () => ok(null)),
      list: vi.fn(async () => ok([])),
      exportMarkdown: vi.fn(async () => ok({ canceled: true })),
      exportAnki: vi.fn(async () => ok({ canceled: true, paths: [] })),
      attachments: vi.fn(async () => ok([])),
      regenerate: vi.fn(async () => ok({ version: 1, images: 0, hitRate: { hits: 0, total: 0 } })),
      exportPdfDialog: vi.fn(async () => ok({ canceled: true })),
      exportPdfWrite: vi.fn(async () => ok({ path: 'x.pdf', bytes: 1 })),
      revealFile: vi.fn(async () => ok(true))
    },
    qa: {
      ask: vi.fn(async () => ok({ id: 'q1', answer: '回答' })),
      history: vi.fn(async () => ok(qaHistoryRows)),
      recent: vi.fn(async () => ok([]))
    },
    settings: {
      get: vi.fn(async (): Promise<ApiResult<AppSettingsInfo>> => ok({ libraryRoot: 'L', cacheDir: 'C', theme: 'auto' })),
      setCacheDir: vi.fn(async () => ok({ cacheDir: 'C' })),
      setTheme: vi.fn(async () => ok({ theme: 'dark' })),
      chooseLibrary: vi.fn(async () => ok({ canceled: true })),
      openPath: vi.fn(async () => ok(true)),
      onMigrateProgress: vi.fn(() => () => undefined)
    },
    log: {
      rendererError: vi.fn(async () => ok(true))
    }
  } as unknown as SeuSummaryBridge
}

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
    // 批C: the app persists its UI snapshot in localStorage — tests must not
    // inherit each other's selections/expanded state.
    window.localStorage.clear()
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

  it('restores the persisted lesson selection after a renderer reload (批C)', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    const saved = JSON.parse(window.localStorage.getItem('seu-summary.ui-state.v1') ?? '{}') as { currentLesson?: string }
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
    courseTreeRows = []
    mount(<App bridge={bridge} />)
    await waitForSelector('.welcome-guide')
  })

  it('echoes recorded qa history for the selected lesson, oldest first', async () => {
    const bridge = makeBridge()
    qaHistoryRows = [
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
    qaHistoryRows = [{ question: '旧课时的问题', answer: '答' }]
    const host = mount(<App bridge={bridge} />)
    await selectFirstLesson(bridge)
    openQaTab(host)
    await waitForSelector('.qa-q')

    // Re-select the same lesson with an emptied history: panel must clear.
    qaHistoryRows = []
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
    courseTreeRows = [
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
    window.localStorage.clear()
    const bridge = makeBridge()
    courseTreeRows = [
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

  it('login flips the badge and logout clears the tree and qa panel', async () => {
    const bridge = makeBridge()
    qaHistoryRows = [{ question: '问', answer: '答' }]
    const host = mount(<App bridge={bridge} />)
    await expandAllCourses()
    click(document.querySelector('.course-head'))
    await waitForSelector('.lesson-row')

    // logged_out topbar shows the login button first; B2 asks for a jump
    // confirmation before the window becomes the school's page.
    click(host.querySelector('.topbar button.primary'))
    await waitForSelector('.dialog')
    const jump = Array.from(host.querySelectorAll('.dialog-actions button')).find((b) => b.textContent === '跳转')
    click(jump ?? null)
    await waitForSelector('[data-testid="session-badge"].logged_in')

    // C4: logout also confirms first.
    click(host.querySelector('.topbar .btn:not(.primary)'))
    await waitForSelector('.dialog')
    const logoutConfirm = Array.from(host.querySelectorAll('.dialog-actions button')).find((b) => b.textContent === '退出')
    click(logoutConfirm ?? null)
    await waitForSelector('[data-testid="session-badge"].logged_out')
    await waitForGone('.lesson-row')
    expect(bridge.school.logout).toHaveBeenCalled()
  })
})
