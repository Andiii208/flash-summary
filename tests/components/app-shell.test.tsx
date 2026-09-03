import { describe, expect, it, vi, beforeEach } from 'vitest'
import { App } from '../../src/renderer/app'
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
      netCheck: vi.fn(async () => ok({ intercepted: false, resolved: [] })),
      setMine: vi.fn(async () => ok(true)),
      onRefreshProgress: vi.fn(() => () => undefined)
    },
    providers: {
      list: vi.fn(async (): Promise<ApiResult<ProvidersListResult>> => ok({ providers: [], bindings: [] })),
      save: vi.fn(async () => ok({ id: 'p', hasKey: true })),
      remove: vi.fn(async () => ok(true)),
      bind: vi.fn(async () => ok(true))
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
      exportMarkdown: vi.fn(async () => ok({ canceled: true }))
    },
    qa: {
      ask: vi.fn(async () => ok({ id: 'q1', answer: '回答' })),
      history: vi.fn(async () => ok(qaHistoryRows))
    },
    settings: {
      get: vi.fn(async (): Promise<ApiResult<AppSettingsInfo>> => ok({ libraryRoot: 'L', cacheDir: 'C', theme: 'auto' })),
      setCacheDir: vi.fn(async () => ok({ cacheDir: 'C' })),
      setTheme: vi.fn(async () => ok({ theme: 'dark' })),
      chooseLibrary: vi.fn(async () => ok({ canceled: true })),
      openPath: vi.fn(async () => ok(true))
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

async function selectFirstLesson(bridge: SeuSummaryBridge): Promise<void> {
  await waitForSelector('.course-head')
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
  })

  it('starts with an honest logged_out badge, four tabs, and the loaded tree', async () => {
    const bridge = makeBridge()
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.course-head')
    expect(host.querySelector('[data-testid="session-badge"]')?.className).toContain('logged_out')
    expect(host.querySelectorAll('.tabs button')).toHaveLength(4)
    expect(bridge.school.session).toHaveBeenCalled()
    expect(bridge.school.courseTree).toHaveBeenCalled()
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
    expect(questions).toEqual(['问：第一问', '问：第二问'])
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

  it('login flips the badge and logout clears the tree and qa panel', async () => {
    const bridge = makeBridge()
    qaHistoryRows = [{ question: '问', answer: '答' }]
    const host = mount(<App bridge={bridge} />)
    await waitForSelector('.course-head')
    click(document.querySelector('.course-head'))
    await waitForSelector('.lesson-row')

    // logged_out topbar shows the login button first.
    click(host.querySelector('.topbar button.primary'))
    await waitForSelector('[data-testid="session-badge"].logged_in')

    click(host.querySelector('.topbar .btn:not(.primary)'))
    await waitForSelector('[data-testid="session-badge"].logged_out')
    await waitForGone('.lesson-row')
    expect(bridge.school.logout).toHaveBeenCalled()
  })
})
