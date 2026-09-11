/**
 * 声明批2: the shared App-shell fake bridge.
 *
 * Extracted from tests/components/app-shell.test.tsx when the consent gate
 * arrived, so the shell tests and the gate test (and every future bridge
 * addition) share ONE fixture instead of two copies drifting apart.
 *
 * Call `makeBridge()` per test — it resets `fakeState`. Tests that need a
 * different tree/history assign to `fakeState` AFTER calling makeBridge (the
 * stubs read it lazily at call time, which is what makes that work).
 */
import { vi } from 'vitest'
import type { AppSettingsInfo, CourseTreeInfo, ProvidersListResult, SeuSummaryBridge, TaskRowInfo } from '../../src/shared/bridge'
import type { ApiResult } from '../../src/shared/api-result'
import { DISCLAIMER_TEXT_VERSION } from '../../src/shared/disclaimer'
import { COPYRIGHT_NOTICE_VERSION } from '../../src/shared/copyright-notice'

export const TREE: CourseTreeInfo[] = [
  { id: 'c1', name: '数据结构', lessons: [{ id: 'l1', title: '第1讲', hasNote: false }] }
]

/** Envelope helper — also used by tests that swap a single stub's answer. */
export function ok<T>(value: T): ApiResult<T> {
  return { ok: true, value }
}

export interface FakeAppState {
  courses: CourseTreeInfo[]
  qaHistory: Array<{ question: string; answer: string }>
  /** 声明批2: what settings:get reports for the consent gate. */
  disclaimerAccepted: boolean
  /** When set, settings:get fails with this message (boot error state). */
  settingsError: string | null
  /** When true, settings:get never settles (boot loading state). */
  settingsPending: boolean
  /** 声明批4: whether the export copyright notice has been opted out of.
   *  Default false — the notice is armed, which is the honest fresh-install
   *  state and what the export tests need to drive. */
  copyrightNoticeOptOut: boolean
}

/** Mutable fixture state — assign after makeBridge() to steer a single test. */
export const fakeState: FakeAppState = {
  courses: TREE,
  qaHistory: [],
  disclaimerAccepted: true,
  settingsError: null,
  settingsPending: false,
  copyrightNoticeOptOut: false
}

function resetFakeState(): void {
  fakeState.courses = TREE
  fakeState.qaHistory = []
  // The shell renders only once consent is recorded, so the shell tests'
  // default is «already accepted»; the gate test flips it to false.
  fakeState.disclaimerAccepted = true
  fakeState.settingsError = null
  fakeState.settingsPending = false
  fakeState.copyrightNoticeOptOut = false
}

export function makeBridge(): SeuSummaryBridge {
  resetFakeState()
  return {
    school: {
      login: vi.fn(async () => ok({ state: 'logged_in' })),
      logout: vi.fn(async () => ok({ state: 'logged_out' })),
      session: vi.fn(async () => ok({ state: 'logged_out' })),
      listCourses: vi.fn(async () => ok({ loaded: 0, platformTotal: 0, platformPages: 1 })),
      addManualCourse: vi.fn(async () => ok({ courseId: 'c', lessonId: 'l' })),
      courseTree: vi.fn(async () => ok(fakeState.courses)),
      harvestLessons: vi.fn(async () => ok({ lessons: 0 })),
      harvestState: vi.fn(async () => ok({ inflight: [], outcome: null })),
      netCheck: vi.fn(async () => ok({ intercepted: false, resolved: [] })),
      setMine: vi.fn(async () => ok(true)),
      onRefreshProgress: vi.fn(() => () => undefined)
    },
    bilibili: {
      login: vi.fn(async () => ok({ qrUrl: 'https://passport.bilibili.com/qr' })),
      loginStatus: vi.fn(async () => ok({ status: 'inactive' })),
      logout: vi.fn(async () => ok({ state: 'logged_out' })),
      session: vi.fn(async () => ok({ state: 'logged_out', savedAt: null })),
      resolve: vi.fn(async () => ok({ bvid: 'BV1X', requestedPage: null, title: 't', coverUrl: '', upMid: 1, pages: [] })),
      import: vi.fn(async () => ok({ courseId: 'b', lessonIds: [] }))
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
      remove: vi.fn(async () => ok(true)),
      clearFinished: vi.fn(async () => ok({ removed: 0 })),
      onProgress: vi.fn(() => () => undefined)
    },
    notes: {
      latest: vi.fn(async () => ok(null)),
      list: vi.fn(async () => ok([])),
      courseHealth: vi.fn(async () => ok([])),
      exportMarkdown: vi.fn(async () => ok({ canceled: true })),
      exportObsidian: vi.fn(async () => ok({ canceled: true, path: 'x.md', version: 1 })),
      exportCourseObsidian: vi.fn(async () => ok({ canceled: true, exported: 0, skipped: 0 })),
      exportAnki: vi.fn(async () => ok({ canceled: true, paths: [] })),
      exportSvg: vi.fn(async () => ok({ canceled: true, path: 'x.svg' })),
      courseTree: vi.fn(async () => ok({ tree: { title: 't', children: [] }, lessons: 0, skipped: 0 })),
      attachments: vi.fn(async () => ok([])),
      attachmentData: vi.fn(async () => ok(null)),
      regenerate: vi.fn(async () => ok({ version: 1, images: 0, hitRate: { hits: 0, total: 0 } })),
      polish: vi.fn(async () => ok({ version: 2, hitRate: { hits: 0, total: 0 } })),
      exportPdfDialog: vi.fn(async () => ok({ canceled: true })),
      exportPdfWrite: vi.fn(async () => ok({ path: 'x.pdf', bytes: 1 })),
      revealFile: vi.fn(async () => ok(true))
    },
    qa: {
      ask: vi.fn(async () => ok({ id: 'q1', answer: '回答' })),
      history: vi.fn(async () => ok(fakeState.qaHistory)),
      recent: vi.fn(async () => ok([]))
    },
    settings: {
      get: vi.fn(async (): Promise<ApiResult<AppSettingsInfo>> => {
        if (fakeState.settingsPending) return await new Promise<ApiResult<AppSettingsInfo>>(() => undefined)
        if (fakeState.settingsError != null) return { ok: false, error: fakeState.settingsError }
        return ok({
          libraryRoot: 'L',
          cacheDir: 'C',
          theme: 'auto',
          disclaimerVersion: DISCLAIMER_TEXT_VERSION,
          disclaimerAccepted: fakeState.disclaimerAccepted,
          copyrightNoticeVersion: COPYRIGHT_NOTICE_VERSION,
          copyrightNoticeOptOut: fakeState.copyrightNoticeOptOut
        })
      }),
      setCacheDir: vi.fn(async () => ok({ cacheDir: 'C' })),
      setTheme: vi.fn(async () => ok({ theme: 'dark' })),
      chooseLibrary: vi.fn(async () => ok({ canceled: true })),
      openPath: vi.fn(async () => ok(true)),
      // Models the real handler: recording consent flips the stored state, so
      // the re-read that follows is what lifts the gate.
      acceptDisclaimer: vi.fn(async () => {
        fakeState.disclaimerAccepted = true
        return ok({ version: DISCLAIMER_TEXT_VERSION })
      }),
      // Same shape as the real handler: recording the opt-out is what stops the
      // reminder, and the re-read that follows is what the UI acts on.
      optOutCopyrightNotice: vi.fn(async () => {
        fakeState.copyrightNoticeOptOut = true
        return ok({ version: COPYRIGHT_NOTICE_VERSION })
      }),
      onMigrateProgress: vi.fn(() => () => undefined)
    },
    log: {
      rendererError: vi.fn(async () => ok(true))
    },
    // 声明批6: 反馈通道的假实现——注意这里**没有任何发送方法**，与真实桥面一致
    // （只给入口、不上报）。
    feedback: {
      openForm: vi.fn(async () => ok(true)),
      diagnostics: vi.fn(async () => ok({ text: '—— Flash Summary 诊断信息 ——\n应用版本：0.0.0-test' }))
    }
  } as unknown as SeuSummaryBridge
}
