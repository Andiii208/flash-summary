import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { ChevronDown, ChevronRight } from 'lucide-preact'
import { render } from 'preact'
import type { AppSettingsInfo, CourseTreeInfo, NoteAttachmentInfo, NoteIndexInfo, ProvidersListResult, QaRecentInfo, SeuSummaryBridge, TaskProgressInfo, TaskRowInfo } from '../shared/bridge'
import type { Note } from '../shared/notes/schema'
import { noteToMarkdown } from '../shared/notes/markdown'
import { withSessionRetry } from '../shared/session-retry'
import { orderMyCoursesFirst, orderTreeLessonsByNumber } from '../shared/course-order'
import type { ApiResult } from '../shared/api-result'
import { CourseTree } from './components/CourseTree'
import { MyStudyPanel } from './components/MyStudyPanel'
import { TaskPanel } from './components/TaskPanel'
import { NoteViewer, type LessonContext } from './components/NoteViewer'
import { PrintHandout } from './components/PrintHandout'
import { QaPanel, type QaEntry } from './components/QaPanel'
import { TopBar, type SessionState } from './components/TopBar'
import { ToastArea, type ToastItem, type ToastKind } from './components/ToastArea'
import { Dialog } from './ui/Dialog'
import { WelcomeGuide } from './components/WelcomeGuide'
import { ManualAdd } from './components/ManualAdd'
import { SettingsPanel } from './components/SettingsPanel'

/** 2026-09-04: wait for every <img> in the print handout to decode before
 *  printing — printToPDF snapshots the live DOM, undecoded images come out blank. */
function waitForImages(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll('img')]
  return Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          })
    )
  ).then(() => undefined)
}

type MainTab = 'tasks' | 'notes' | 'qa' | 'settings'

/** school:listCourses envelope value (paged refresh, B1). */
type CourseListResult = { loaded: number; platformTotal: number; platformPages: number }

const TAB_LABELS: Array<{ id: MainTab; label: string }> = [
  { id: 'tasks', label: '任务' },
  { id: 'notes', label: '笔记' },
  { id: 'qa', label: '追问' },
  { id: 'settings', label: '设置' }
]

/** 批C: sidebar/context persistence — the harvest and login flows navigate
 *  the main window away, which unloads this renderer; without persistence
 *  the user lands back at the top of a collapsed tree (field 2026-09-04). */
const UI_STATE_KEY = 'seu-summary.ui-state.v1'
const HARVEST_SEQ_KEY = 'seu-summary.harvest-seq.v1'

interface PersistedUiState {
  expanded: string[]
  currentLesson: string
  allCoursesOpen: boolean
  tab: MainTab
}

function loadPersistedUi(): Partial<PersistedUiState> {
  try {
    const raw = window.localStorage.getItem(UI_STATE_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>
    return parsed != null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function savePersistedUi(patch: Partial<PersistedUiState>): void {
  try {
    const next = { ...loadPersistedUi(), ...patch }
    window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(next))
  } catch {
    // Persistence is an enhancement; quota/private-mode failures stay silent.
  }
}

function readHarvestSeq(): number {
  try {
    return Number(window.localStorage.getItem(HARVEST_SEQ_KEY) ?? '0') || 0
  } catch {
    return 0
  }
}

function writeHarvestSeq(seq: number): void {
  try {
    window.localStorage.setItem(HARVEST_SEQ_KEY, String(seq))
  } catch {
    // See savePersistedUi.
  }
}

/** B2: «don't tell me again» for the platform-jump confirmation. */
const JUMP_SKIP_KEY = 'seu-summary.jump-confirm.skip'

function readJumpSkip(): boolean {
  try {
    return window.localStorage.getItem(JUMP_SKIP_KEY) === '1'
  } catch {
    return false
  }
}

function writeJumpSkip(): void {
  try {
    window.localStorage.setItem(JUMP_SKIP_KEY, '1')
  } catch {
    // See savePersistedUi.
  }
}

export function App({ bridge }: { bridge: SeuSummaryBridge }): JSX.Element {
  // 批C: the active tab survives renderer reloads (harvest/login navigation).
  const [tab, setTabState] = useState<MainTab>(() => loadPersistedUi().tab ?? 'tasks')
  const setTab = useCallback((next: MainTab): void => {
    setTabState(next)
    savePersistedUi({ tab: next })
  }, [])
  const goTasks = useCallback(() => setTab('tasks'), [setTab])
  const goNotes = useCallback(() => setTab('notes'), [setTab])
  const goSettings = useCallback(() => setTab('settings'), [setTab])
  const state = useAppState(bridge, goTasks, goNotes, goSettings)
  const showWelcome = state.treeLoaded && state.tree.length === 0

  return (
    <>
      {/* 2026-09-04: hidden print handout — populated only during a PDF export.
       *  Lives OUTSIDE .app-shell: print.css hides the whole shell under print
       *  media, and display:none on an ancestor would hide this too. */}
      <div id="print-root" />
      {/* B2: expectation-setting before the window becomes the school's page. */}
      <JumpConfirmDialog
        pending={state.jumpConfirm}
        onAccept={(remember) => {
          if (remember) writeJumpSkip()
          state.acceptJump()
        }}
        onCancel={state.dismissJump}
      />
      <div class="app-shell">
      <TopBar session={state.session} busy={state.sessionBusy} running={state.running} onLogin={state.login} onLogout={state.logout} />
      <ToastArea toasts={state.toasts} />
      <div class="app-main">
        <aside class="sidebar">
          <div class="sidebar-head">
            <h2>课程</h2>
            <button
              class="btn small ghost"
              onClick={state.refreshTree}
              disabled={state.session === 'logged_out' || state.refreshBusy}
            >
              {state.refreshBusy
                ? state.refreshProgress != null
                  ? `刷新中 ${state.refreshProgress.page}/${state.refreshProgress.pageCount} 页…`
                  : '刷新中…'
                : '刷新课程'}
            </button>
          </div>
          {state.tree.length > 0 && (
            <input
              class="search-input"
              type="search"
              placeholder="搜索课程 / 教师 / 学期…"
              value={state.query}
              onInput={(e) => state.setQuery((e.target as HTMLInputElement).value)}
            />
          )}
          {state.tree.length > 0 && state.refreshMeta != null && (
            <p class="tree-meta">
              已加载 {state.refreshMeta.loaded} 门 / 全校约 {state.refreshMeta.platformTotal} 门（搜索仅覆盖已加载课程）
            </p>
          )}
          {showWelcome ? (
            <WelcomeGuide onLogin={state.login} onOpenSettings={() => setTab('settings')} busy={state.sessionBusy} />
          ) : state.searchMode ? (
            <CourseTree
              tree={state.filteredTree}
              selectedLesson={state.currentLesson}
              expanded={state.expanded}
              searching
              sameCourseIds={state.sameCourseIds}
              harvestInflight={state.harvestInflight}
              onToggle={state.toggleCourse}
              onSelect={state.selectLesson}
              onHarvestLessons={state.harvestLessons}
              onToggleMine={state.toggleMine}
            />
          ) : (
            <>
              <MyStudyPanel
                mine={state.mineCourses}
                extracted={state.extractedCourses}
                sameCourses={state.sameCourses}
                selectedLesson={state.currentLesson}
                expanded={state.expanded}
                onToggle={state.toggleCourse}
                onSelect={state.selectLesson}
                onHarvestLessons={state.harvestLessons}
                onToggleMine={state.toggleMine}
              />
              <section class="all-courses">
                <button
                  class="all-courses-head"
                  data-testid="all-courses-toggle"
                  aria-expanded={state.allCoursesOpen}
                  onClick={state.toggleAllCourses}
                >
                  <span class="caret">{state.allCoursesOpen ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}</span>
                  <span>全部课程</span>
                  <span class="all-courses-count">{state.tree.length}</span>
                </button>
                {state.allCoursesOpen && (
                  <>
                    <div class="tree-tools">
                      <button class="btn small ghost" onClick={state.expandAll}>
                        全部展开
                      </button>
                      <button class="btn small ghost" onClick={state.collapseAll}>
                        全部收起
                      </button>
                    </div>
                    <CourseTree
                      tree={state.filteredTree.slice(0, state.visibleCourses)}
                      selectedLesson={state.currentLesson}
                      expanded={state.expanded}
                      searching={false}
                      sameCourseIds={state.sameCourseIds}
                      harvestInflight={state.harvestInflight}
                      onToggle={state.toggleCourse}
                      onSelect={state.selectLesson}
                      onHarvestLessons={state.harvestLessons}
                      onToggleMine={state.toggleMine}
                    />
                    {state.filteredTree.length > state.visibleCourses && (
                      <button class="btn small ghost show-more" onClick={state.showMoreCourses}>
                        显示更多（还有 {state.filteredTree.length - state.visibleCourses} 门）
                      </button>
                    )}
                  </>
                )}
              </section>
            </>
          )}
          <ManualAdd onAdd={state.addManual} />
        </aside>
        <main class="content">
          <nav
            class="tabs"
            role="tablist"
            onKeyDown={(e) => {
              // M3-2: proper tablist keyboard support (roving focus + select).
              const buttons = [...e.currentTarget.querySelectorAll('button')]
              const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
              if (i < 0) return
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]
                next?.focus()
                next?.click()
              }
            }}
          >
            {TAB_LABELS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                tabIndex={tab === t.id ? 0 : -1}
                class={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {tab === 'tasks' && (
            <TaskPanel
              currentLesson={state.currentLesson}
              lessonLabel={state.lessonContextOrIndex != null ? [state.lessonContextOrIndex.courseName, state.lessonContextOrIndex.lessonTitle].filter(Boolean).join(' · ') : null}
              running={state.running}
              busy={state.submitBusy}
              progress={state.progress}
              history={state.history}
              globalHistory={state.globalHistory}
              onCreateRun={state.createAndRun}
              onRetry={state.retryTask}
              onCancel={state.cancelTask}
              onDelete={state.removeTask}
              onClearFinished={state.clearFinishedTasks}
              onOpenNote={state.openLessonNotes}
            />
          )}
          {tab === 'notes' && (
            <NoteViewer
              note={state.note}
              attachments={state.attachments}
              lesson={state.lessonContextOrIndex}
              library={state.noteIndex}
              onOpenLesson={state.selectLesson}
              onGoTasks={goTasks}
              prevLesson={state.lessonNeighbors.prev}
              nextLesson={state.lessonNeighbors.next}
              onNavigateLesson={state.openLessonNotes}
              regenBusy={state.noteRegenBusy}
              pdfBusy={state.pdfBusy}
              onRegenerate={state.currentLesson !== '' ? () => state.regenerateNote(state.currentLesson) : undefined}
              onExportPdf={state.currentLesson !== '' && state.note != null ? () => state.exportNotePdf(state.currentLesson) : undefined}
              onExport={state.currentLesson !== '' ? () => state.exportNote(state.currentLesson) : undefined}
              onExportAnki={state.currentLesson !== '' && state.note != null ? () => state.exportNoteAnki(state.currentLesson) : undefined}
              onCopy={state.copyNote}
            />
          )}
          {tab === 'qa' && (
            <QaPanel
              entries={state.qaEntries}
              busy={state.qaBusy}
              hasLesson={state.currentLesson !== ''}
              onAsk={state.ask}
              recent={state.qaRecent}
              onOpenLesson={state.selectLesson}
            />
          )}
          {tab === 'settings' && (
            <SettingsPanel
              settings={state.settings}
              session={state.session}
              sessionInfo={state.sessionInfo}
              sessionBusy={state.sessionBusy}
              onLogin={state.login}
              onLogout={state.logout}
              providers={state.providers}
              providerBusy={state.providerBusy}
              onSaveProvider={state.saveProvider}
              onRemoveProvider={state.removeProvider}
              onTestProvider={state.testProvider}
              providerTestResult={state.providerTest}
              onSetCacheDir={state.setCacheDir}
              onSetTheme={state.setTheme}
              onChooseLibrary={state.chooseLibrary}
              onOpenPath={state.openPath}
            />
          )}
        </main>
      </div>
      </div>
    </>
  )
}

/** B2: platform-jump confirmation with a «don't show again» opt-out. */
function JumpConfirmDialog({
  pending,
  onAccept,
  onCancel
}: {
  pending: { kind: 'login' | 'harvest'; action: () => void } | null
  onAccept: (remember: boolean) => void
  onCancel: () => void
}): JSX.Element | null {
  const [remember, setRemember] = useState(false)
  if (pending == null) return null
  const login = pending.kind === 'login'
  return (
    <Dialog
      open
      title={login ? '跳转到学校登录页？' : '跳转到学校播放页抓取课时目录？'}
      message={
        login
          ? '整个窗口会先变成学校的登录页面（通常 1-2 分钟），登录成功后自动回到应用，请稍候不要关闭。'
          : '整个窗口会先变成学校的播放页面（通常 30-60 秒），抓取完成后自动回到应用并展开这门课，请稍候不要关闭。'
      }
      confirmLabel="跳转"
      onConfirm={() => onAccept(remember)}
      onCancel={onCancel}
    >
      <label class="dialog-check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember((e.target as HTMLInputElement).checked)} />
        以后不再提示
      </label>
    </Dialog>
  )
}

interface AppState {
  session: SessionState
  sessionInfo: { savedAt: string | null; expiresAt: number | null }
  sessionBusy: boolean
  /** A course-list refresh is in flight (network + possible login round-trip). */
  refreshBusy: boolean
  /** Loaded/total boundary after the last paged refresh (B2). */
  refreshMeta: { loaded: number; platformTotal: number } | null
  /** Live page progress while a paged refresh runs (B2). */
  refreshProgress: { page: number; pageCount: number } | null
  tree: CourseTreeInfo[]
  /** Courses filtered by the sidebar search query. */
  filteredTree: CourseTreeInfo[]
  treeLoaded: boolean
  /** Courses the user explicitly expanded (default: all collapsed). */
  expanded: ReadonlySet<string>
  query: string
  /** 防抖后的搜索态：true 时侧栏切到纯搜索结果列表（M2 批 A）。 */
  searchMode: boolean
  currentLesson: string
  /** Same-subject sections of pinned courses, for the «同课» badge (C4). */
  sameCourseIds: ReadonlySet<string>
  /** 「我的学习」三组（M2 批 A）。 */
  mineCourses: CourseTreeInfo[]
  /** V4 试卷头: identity of the selected lesson (course/teacher/lesson title). */
  lessonContext: LessonContext | null
  /** 批B: same as lessonContext but falls back to the note library entry. */
  lessonContextOrIndex: LessonContext | null
  extractedCourses: CourseTreeInfo[]
  sameCourses: CourseTreeInfo[]
  allCoursesOpen: boolean
  toggleAllCourses: () => void
  visibleCourses: number
  showMoreCourses: () => void
  note: Note | null
  /** 批B: cross-lesson note library (notes tab empty state). */
  noteIndex: NoteIndexInfo[]
  /** 批B: recent Q&A across lessons (qa tab empty state). */
  qaRecent: QaRecentInfo[]
    /** B4: neighbors of the selected lesson (sorted, same course). */
    lessonNeighbors: { prev: { id: string; title: string } | null; next: { id: string; title: string } | null }
    /** B2: pending platform-jump confirmation (dialog state). */
    jumpConfirm: { kind: 'login' | 'harvest'; action: () => void } | null
    acceptJump: () => void
    dismissJump: () => void
    /** 批C: courses whose catalog harvest is currently running. */
    harvestInflight: ReadonlySet<string>
  history: TaskRowInfo[]
  /** Recent tasks across all lessons (serial queue visibility). */
  globalHistory: TaskRowInfo[]
  progress: TaskProgressInfo | null
  running: boolean
  submitBusy: boolean
  qaEntries: QaEntry[]
  qaBusy: boolean
  providers: ProvidersListResult | null
  providerBusy: boolean
  settings: AppSettingsInfo | null
  toasts: ToastItem[]
  login: () => void
  logout: () => void
  refreshTree: () => void
  toggleCourse: (courseId: string) => void
  expandAll: () => void
  collapseAll: () => void
  setQuery: (q: string) => void
  harvestLessons: (courseId: string) => void
  toggleMine: (courseId: string, mine: boolean) => void
  selectLesson: (lessonId: string) => void
  addManual: (courseId: string, lessonId: string) => void
  /** A2: one click from a finished task to its note. */
  openLessonNotes: (lessonId: string) => void
  /** A1: create + run with a pre-flight capability check. */
  createAndRun: () => void
  retryTask: (taskId: string) => void
  cancelTask: (taskId?: string) => void
  removeTask: (taskId: string) => void
  clearFinishedTasks: () => void
  ask: (question: string) => void
  saveProvider: (input: { name: string; baseUrl: string; apiKey: string; capability: string; model: string }) => void
  removeProvider: (id: string) => void
  testProvider: (input: { baseUrl: string; apiKey: string; model: string }) => void
  providerTest: { ok: boolean; text: string } | null
  exportNote: (lessonId: string) => void
  /** 2026-09-04 roadmap 2.2: export Anki TSV decks (concepts + quiz). */
  exportNoteAnki: (lessonId: string) => void
  copyNote: () => void
  /** 2026-09-04: regenerate + attachments + PDF handout for the note views. */
  attachments: NoteAttachmentInfo[]
  noteRegenBusy: boolean
  regenerateNote: (lessonId: string) => void
  pdfBusy: boolean
  exportNotePdf: (lessonId: string) => void
  setCacheDir: (dir: string) => void
  setTheme: (theme: 'auto' | 'light' | 'dark') => void
  chooseLibrary: () => void
  openPath: (kind: 'library' | 'cache' | 'exports' | 'logs') => void
}

/** Rough percent per stage for restored in-flight tasks (UI hint only). */
const RESTORE_PERCENT: Record<string, number> = {
  pending: 2,
  fetching_course: 10,
  downloading_video: 35,
  extracting_audio: 55,
  transcribing: 70,
  extracting_visuals: 88,
  summarizing: 94
}

/** True while the task still belongs to the serial queue. */
function isActiveState(state: string): boolean {
  return state !== 'succeeded' && state !== 'failed'
}

/** A2: readable task identity (course · lesson) for toasts. */
function taskLabelOf(row: TaskRowInfo): string {
  const names = [row.course_name, row.lesson_title].filter((n): n is string => n != null && n !== '')
  return names.length > 0 ? names.join(' · ') : row.lesson_id
}

/** Debounce fast-changing input values (sidebar search, M2 批 A). */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function useAppState(bridge: SeuSummaryBridge, goTasks: () => void, goNotes: () => void, goSettings: () => void): AppState {
  const [session, setSession] = useState<SessionState>('logged_out')
  const [sessionInfo, setSessionInfo] = useState<{ savedAt: string | null; expiresAt: number | null }>({
    savedAt: null,
    expiresAt: null
  })
  const [sessionBusy, setSessionBusy] = useState(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  /** Loaded/total boundary after the last refresh (B2). */
  const [refreshMeta, setRefreshMeta] = useState<{ loaded: number; platformTotal: number } | null>(null)
  /** Live page progress while a paged refresh runs (B2). */
  const [refreshProgress, setRefreshProgress] = useState<{ page: number; pageCount: number } | null>(null)
  const [tree, setTree] = useState<CourseTreeInfo[]>([])
  const [treeLoaded, setTreeLoaded] = useState(false)
  // 批C: restore the persisted sidebar/context (collapsed/expanded state used
  // to reset on every renderer reload, e.g. after a catalog harvest).
  const [persisted] = useState(loadPersistedUi)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(persisted.expanded ?? []))
  const [query, setQuery] = useState('')
  /** M2 批 A: 300ms 防抖后的搜索词（636+ 门课每键全量过滤太浪费）。 */
  const debouncedQuery = useDebounced(query, 300)
  const searchMode = debouncedQuery.trim() !== ''
  /** 全部课程分组默认折叠——「我的学习」是主语，目录是字典。 */
  const [allCoursesOpen, setAllCoursesOpen] = useState(persisted.allCoursesOpen ?? false)
  const [currentLesson, setCurrentLesson] = useState(persisted.currentLesson ?? '')
  const [note, setNote] = useState<Note | null>(null)
  /** 批B: cross-lesson note library + recent Q&A (tab empty states). */
  const [noteIndex, setNoteIndex] = useState<NoteIndexInfo[]>([])
  const [qaRecent, setQaRecent] = useState<QaRecentInfo[]>([])
  /** 批C: courses whose catalog harvest is in flight (play-page navigation). */
  const [harvestInflight, setHarvestInflight] = useState<ReadonlySet<string>>(new Set())
  /** 2026-09-04: lesson attachments (keyframes/PPT) for the note views. */
  const [attachments, setAttachments] = useState<NoteAttachmentInfo[]>([])
  const [noteRegenBusy, setNoteRegenBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [history, setHistory] = useState<TaskRowInfo[]>([])
  const [globalHistory, setGlobalHistory] = useState<TaskRowInfo[]>([])
  const [progress, setProgress] = useState<TaskProgressInfo | null>(null)
  const [running, setRunning] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [qaEntries, setQaEntries] = useState<QaEntry[]>([])
  const [qaBusy, setQaBusy] = useState(false)
  const [providers, setProviders] = useState<ProvidersListResult | null>(null)
  const [providerBusy, setProviderBusy] = useState(false)
  const [settings, setSettings] = useState<AppSettingsInfo | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(0)
  const lessonRef = useRef('')
  /** The mount-time session read runs once per real mount: the effect's
   *  unstable deps (refreshTree flips with refreshBusy) must not re-read and
   *  clobber a session state the user just set by logging in. */
  const sessionReadDone = useRef(false)

  // Theme override (U3): auto follows the system via CSS; explicit light/dark
  // sets an html data attribute that wins over prefers-color-scheme.
  useEffect(() => {
    const root = document.documentElement
    if (settings == null || settings.theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = settings.theme
  }, [settings])

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info', action?: { actionLabel: string; onAction: () => void }): void => {
      const id = ++toastId.current
      setToasts((ts) => [...ts, { id, message, kind, ...(action ?? {}) }])
      const ms = action != null ? 8000 : kind === 'error' ? 6500 : 3500
      window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), ms)
    },
    []
  )

  const applyLocalTree = useCallback(async (): Promise<void> => {
    const res = await bridge.school.courseTree()
    if (res.ok && res.value != null) {
      // A4: store lessons «第N节»-sorted so every consumer reads one order.
      setTree(orderTreeLessonsByNumber(res.value))
      setTreeLoaded(true)
    }
  }, [bridge])

  /** A5 preflight: turn a proxy Fake-IP takeover into an actionable message
   *  instead of a dead refresh/login. Inconclusive (DNS itself failing) does
   *  not block — the real action will surface its own error. */
  const ensureCampusNet = useCallback(async (): Promise<boolean> => {
    const res = await bridge.school.netCheck()
    if (res.ok && res.value?.intercepted === true) {
      toast('检测到代理接管了校园域名解析（Fake-IP），校园请求会被断连。请在 Clash 配置规则顶部加 DOMAIN-SUFFIX,seu.edu.cn,DIRECT（订阅更新会把它冲掉），或退出 TUN 模式后重试。', 'error')
      return false
    }
    return true
  }, [bridge, toast])

  const refreshTree = useCallback(async (): Promise<void> => {
    if (refreshBusy) return
    setRefreshBusy(true)
    try {
      if (await ensureCampusNet()) {
        // User-triggered refresh (spec §2): on session expiry the renderer logs
        // in once via the main window and retries the course list.
        const list = (await withSessionRetry(
          () => bridge.school.listCourses() as Promise<ApiResult<CourseListResult>>,
          () => bridge.school.login()
        )) as ApiResult<CourseListResult>
        if (list.ok && list.value != null) {
          setRefreshMeta({ loaded: list.value.loaded, platformTotal: list.value.platformTotal })
          toast(`已加载 ${list.value.loaded} 门课程（全校约 ${list.value.platformTotal} 门）`, 'success')
        } else if (!list.ok && list.kind === 'session_expired') {
          setSession('logged_out')
          toast('会话已过期，请重新登录', 'error')
        } else if (!list.ok) {
          // Silent failures here read as «the app did nothing» (field case 2026-09-01).
          toast(list.error ?? '刷新失败', 'error')
        }
      }
      await applyLocalTree()
    } finally {
      setRefreshProgress(null)
      setRefreshBusy(false)
    }
  }, [bridge, toast, applyLocalTree, refreshBusy, ensureCampusNet])

  const refreshProviders = useCallback(async (): Promise<void> => {
    const res = await bridge.providers.list()
    if (res.ok && res.value != null) setProviders(res.value)
  }, [bridge])

  const refreshSettings = useCallback(async (): Promise<void> => {
    const res = await bridge.settings.get()
    if (res.ok && res.value != null) setSettings(res.value)
  }, [bridge])

  // All three lesson-scoped loaders guard on lessonRef: a slow response for
  // a previously selected lesson must not overwrite the current one's panel.
  const loadNote = useCallback(async (lessonId: string): Promise<void> => {
    const res = (await bridge.notes.latest(lessonId)) as ApiResult<Note | null>
    if (res.ok && res.value != null && lessonRef.current === lessonId) setNote(res.value)
  }, [bridge])

  /** 2026-09-04: attachments ride along with the note (guarded on lessonRef too). */
  const loadAttachments = useCallback(async (lessonId: string): Promise<void> => {
    const res = await bridge.notes.attachments(lessonId)
    if (res.ok && res.value != null && lessonRef.current === lessonId) setAttachments(res.value)
  }, [bridge])

  const loadHistory = useCallback(async (lessonId: string): Promise<void> => {
    const res = await bridge.tasks.list(lessonId)
    if (res.ok && res.value != null && lessonRef.current === lessonId) setHistory(res.value)
  }, [bridge])

  const loadQaHistory = useCallback(async (lessonId: string): Promise<void> => {
    // Recorded exchanges live in the library (desc); show them oldest first.
    const res = await bridge.qa.history(lessonId)
    if (res.ok && res.value != null && lessonRef.current === lessonId) {
      const rows = res.value as Array<{ question: string; answer: string }>
      setQaEntries(rows.map((r) => ({ question: r.question, answer: r.answer })).reverse())
    }
  }, [bridge])

  const loadGlobalHistory = useCallback(async (): Promise<void> => {
    const res = await bridge.tasks.list()
    if (res.ok && res.value != null) setGlobalHistory(res.value)
  }, [bridge])

  /** 批B: cross-lesson library + recent Q&A feed the tab empty states. */
  const loadNoteIndex = useCallback(async (): Promise<void> => {
    const res = await bridge.notes.list()
    if (res.ok && res.value != null) setNoteIndex(res.value)
  }, [bridge])

  const loadQaRecent = useCallback(async (): Promise<void> => {
    const res = await bridge.qa.recent()
    if (res.ok && res.value != null) setQaRecent(res.value)
  }, [bridge])

  const selectLesson = useCallback(
    (lessonId: string): void => {
      setCurrentLesson(lessonId)
      lessonRef.current = lessonId
      setQaEntries([])
      setAttachments([])
      void loadNote(lessonId)
      void loadAttachments(lessonId)
      void loadHistory(lessonId)
      void loadQaHistory(lessonId)
    },
    [loadNote, loadAttachments, loadHistory, loadQaHistory]
  )

  /** A2: one click from a finished task to its note. */
  const openLessonNotes = useCallback(
    (lessonId: string): void => {
      if (lessonId === '') return
      selectLesson(lessonId)
      goNotes()
    },
    [selectLesson, goNotes]
  )

  // Live refresh progress (B2): stable subscription — the bridge is the only dep.
  useEffect(() => bridge.school.onRefreshProgress((p) => setRefreshProgress(p)), [bridge])

  useEffect(() => {
    let disposed = false
    void (async () => {
      if (sessionReadDone.current) return
      sessionReadDone.current = true
      const s = await bridge.school.session()
      if (disposed || !s.ok || s.value == null) return
      setSession(s.value.state)
      setSessionInfo({ savedAt: s.value.savedAt ?? null, expiresAt: s.value.expiresAt ?? null })
      // V2: the login flow navigates the main window away, so «login just
      // finished» can only be seen by this fresh mount — finish what the
      // user's original action (e.g. 刷新课程) started. A failed embedded
      // login has no surviving renderer: the one-shot outcome channel is
      // the only way the user ever hears about it.
      if (s.value.justLoggedIn === true) {
        toast('登录成功', 'success')
        void refreshTree()
        // M1-3 (B7): after a re-login, surface the retryable failures left
        // by the expired session instead of making the user hunt for them.
        const rows = await bridge.tasks.list()
        if (rows.ok && rows.value != null) {
          const retryable = rows.value.filter((t) => t.state === 'failed' && t.error_kind === 'session_expired')
          if (retryable.length > 0) {
            toast(`会话已恢复，${retryable.length} 个失败任务可重试`, 'success', {
              actionLabel: '去任务页',
              onAction: goTasks
            })
          }
        }
      } else if (s.value.loginOutcome != null) {
        const outcome = s.value.loginOutcome
        if (outcome.ok) toast('登录成功', 'success')
        else toast(`登录失败：${outcome.message.slice(0, 160)}`, 'error')
      }
    })()
    // Mount reads the local tree only: a mount-time listCourses on an expired
    // session auto-opened the CAS login window via withSessionRetry, which
    // read as "the app did nothing" (field case 2026-09-01). Network refresh
    // stays behind the explicit 刷新课程 button.
    void applyLocalTree()
    void refreshProviders()
    void refreshSettings()
    void loadGlobalHistory()
    void loadNoteIndex()
    void loadQaRecent()
    // 批C: resume the persisted lesson selection (loads note/attachments/
    // history/QA so tabs are coherent after a reload).
    const savedLesson = persisted.currentLesson ?? ''
    if (savedLesson !== '') {
      setCurrentLesson(savedLesson)
      lessonRef.current = savedLesson
      void loadNote(savedLesson)
      void loadAttachments(savedLesson)
      void loadHistory(savedLesson)
      void loadQaHistory(savedLesson)
    }
    // The renderer unloads during in-window navigations (harvest/未来登录) —
    // an in-flight task keeps running in main; restore its live state here.
    void (async () => {
      const res = await bridge.tasks.list()
      if (disposed || !res.ok || res.value == null) return
      setGlobalHistory(res.value)
      const active = res.value.find((t) => isActiveState(t.state))
      if (active != null) {
        setRunning(true)
        setProgress({
          taskId: active.id,
          state: active.state,
          stage: active.failed_stage,
          message: '任务进行中（界面重载后恢复显示）',
          percent: RESTORE_PERCENT[active.state] ?? 5
        })
      }
    })()
    const off = bridge.tasks.onProgress((p) => {
      setProgress(p)
      if (p.state === 'succeeded' || p.state === 'failed') void loadGlobalHistory()
      const lid = lessonRef.current
      if (p.state === 'succeeded') {
        // B1: other tasks may still be queued — recompute from the fresh rows.
        void (async () => {
          const rows = await bridge.tasks.list()
          setRunning(rows.ok && rows.value != null ? rows.value.some((t) => isActiveState(t.state)) : false)
          const row = rows.ok && rows.value != null ? rows.value.find((t) => t.id === p.taskId) : undefined
          const doneLesson = row?.lesson_id ?? lid
          void loadNoteIndex()
          if (doneLesson !== '') {
            void loadNote(doneLesson)
            void loadHistory(doneLesson)
          }
          toast(`${row != null ? `「${taskLabelOf(row)}」任务完成` : `任务 ${p.taskId} 完成`}`, 'success', {
            actionLabel: '查看笔记',
            onAction: () => openLessonNotes(doneLesson !== '' ? doneLesson : lid)
          })
        })()
      } else if (p.state === 'failed') {
        void (async () => {
          const rows = await bridge.tasks.list()
          setRunning(rows.ok && rows.value != null ? rows.value.some((t) => isActiveState(t.state)) : false)
        })()
        toast(p.message, 'error')
        if (p.kind === 'session_expired') toast('会话已过期，登录后可重试此任务', 'error')
      }
    })
    return () => {
      disposed = true
      off()
    }
  }, [bridge, toast, applyLocalTree, refreshProviders, refreshSettings, loadNote, loadAttachments, loadHistory, loadQaHistory, loadGlobalHistory, loadNoteIndex, loadQaRecent, openLessonNotes, refreshTree, goTasks])

  // 批C: write the UI snapshot back on every change — a navigation-induced
  // reload (harvest/login) resumes exactly where the user was. Stale course
  // ids drop out here as soon as the tree no longer contains them.
  useEffect(() => {
    savePersistedUi({ expanded: [...expanded].filter((id) => tree.some((c) => c.id === id)), currentLesson, allCoursesOpen })
  }, [expanded, currentLesson, allCoursesOpen, tree])

  // 批C: watch an in-flight catalog harvest across the navigation that
  // started it; report the outcome once (deduped via the persisted seq).
  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    const initialSeq = readHarvestSeq()
    void (async () => {
      for (;;) {
        if (stopped) return
        const res = await bridge.school.harvestState()
        if (stopped || !res.ok || res.value == null) return
        setHarvestInflight(new Set(res.value.inflight))
        if (res.value.inflight.length === 0) {
          const outcome = res.value.outcome
          if (outcome != null && outcome.seq > initialSeq) {
            writeHarvestSeq(outcome.seq)
            if (outcome.ok) {
              await applyLocalTree()
              setExpanded((prev) => new Set(prev).add(outcome.courseId))
              toast(`已抓取 ${outcome.lessons} 节课时`, 'success')
            } else {
              toast(`抓取课时目录失败：${(outcome.error ?? '未知错误').slice(0, 120)}`, 'error')
            }
          }
          return
        }
        await new Promise((resolve) => {
          timer = window.setTimeout(resolve, 2000)
        })
      }
    })()
    return () => {
      stopped = true
      if (timer != null) window.clearTimeout(timer)
    }
  }, [bridge, applyLocalTree, toast])

  // B2: the main window is about to become the school's page for up to a
  // minute — set the expectation once, with an opt-out (localStorage).
  const [jumpConfirm, setJumpConfirm] = useState<{ kind: 'login' | 'harvest'; action: () => void } | null>(null)
  const confirmPlatformJump = useCallback((kind: 'login' | 'harvest', action: () => void): void => {
    if (readJumpSkip()) {
      action()
      return
    }
    setJumpConfirm({ kind, action })
  }, [])
  const acceptJump = useCallback((): void => {
    const pending = jumpConfirm
    setJumpConfirm(null)
    pending?.action()
  }, [jumpConfirm])
  const dismissJump = useCallback((): void => setJumpConfirm(null), [])

  const login = useCallback((): void => {
    if (sessionBusy) return // one login at a time (stacked windows field case 2026-09-01)
    void (async () => {
      // A5 preflight: a Fake-IP takeover fails the platform page before it
      // loads — explain the fix instead of leaving a dead window.
      if (!(await ensureCampusNet())) return
      confirmPlatformJump('login', () => {
        void (async () => {
          setSessionBusy(true)
          try {
            // V2: the main window navigates to the platform for the login, which
            // unloads this renderer mid-call — completion is handled by the fresh
            // mount (it re-reads the session and auto-refreshes via justLoggedIn).
            // The promise below is only resolved on the legacy SEU_LOGIN_WINDOW=1
            // path, where the app UI stays alive.
            toast('正在跳转到平台登录页，完成后自动返回…')
            const res = await bridge.school.login()
            if (!res.ok) {
              toast(res.error ?? '登录失败', 'error')
              return
            }
            setSession('logged_in')
            toast('登录成功', 'success')
            void refreshTree()
          } catch {
            // Invoke-layer failures already reach the file log; the fresh mount
            // reports the outcome through the one-shot loginOutcome channel.
          } finally {
            setSessionBusy(false)
          }
        })()
      })
    })()
  }, [bridge, toast, refreshTree, sessionBusy, ensureCampusNet, confirmPlatformJump])

  const logout = useCallback((): void => {
    void bridge.school.logout()
    setSession('logged_out')
    setTree([])
    setCurrentLesson('')
    setNote(null)
    setAttachments([])
    setHistory([])
    setQaEntries([])
    toast('已退出登录', 'info')
  }, [bridge, toast])

  const toggleCourse = useCallback((courseId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(courseId)) next.delete(courseId)
      else next.add(courseId)
      return next
    })
  }, [])

  const expandAll = useCallback((): void => {
    setExpanded(new Set(tree.map((c) => c.id)))
  }, [tree])

  const collapseAll = useCallback((): void => {
    setExpanded(new Set())
  }, [])

  // C2/C4: pin sorting — «my courses» first, then other teachers' sections
  // of the same subjects («同课» badge), then the rest of the catalog.
  const orderedTree = useMemo(() => orderMyCoursesFirst(tree), [tree])

  // B4: neighbors of the selected lesson within its course (sorted order —
  // applyLocalTree stores the tree with lessons already «第N节»-sorted).
  const lessonNeighbors = useMemo<{ prev: CourseTreeInfo['lessons'][number] | null; next: CourseTreeInfo['lessons'][number] | null }>(() => {
    if (currentLesson === '') return { prev: null, next: null }
    for (const c of orderedTree.tree) {
      const idx = c.lessons.findIndex((l) => l.id === currentLesson)
      if (idx >= 0) {
        return {
          prev: idx > 0 ? (c.lessons[idx - 1] ?? null) : null,
          next: idx < c.lessons.length - 1 ? (c.lessons[idx + 1] ?? null) : null
        }
      }
    }
    return { prev: null, next: null }
  }, [orderedTree, currentLesson])

  // V4 试卷头: identity of the selected lesson, read from the local tree.
  const lessonContext = useMemo(() => {
    if (currentLesson === '') return null
    for (const c of tree) {
      const lesson = c.lessons.find((l) => l.id === currentLesson)
      if (lesson != null) return { courseName: c.name, teacher: c.teacher ?? undefined, lessonTitle: lesson.title }
    }
    return null
  }, [tree, currentLesson])

  // 批B: when the tree can't resolve the selected lesson (e.g. opened from the
  // note library with that course collapsed), fall back to the library entry.
  const lessonContextOrIndex = useMemo<LessonContext | null>(() => {
    if (lessonContext != null) return lessonContext
    if (currentLesson === '') return null
    const entry = noteIndex.find((e) => e.lessonId === currentLesson)
    if (entry == null) return null
    return {
      courseName: entry.courseName ?? entry.lessonId,
      teacher: entry.teacher ?? undefined,
      lessonTitle: entry.lessonTitle ?? entry.lessonId
    }
  }, [lessonContext, noteIndex, currentLesson])

  const filteredTree = useMemo<CourseTreeInfo[]>(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (q === '') return orderedTree.tree
    return orderedTree.tree
      .filter((c) => {
        const haystack = `${c.name} ${c.teacher ?? ''} ${c.term ?? ''} ${c.id}`.toLowerCase()
        return haystack.includes(q) || c.lessons.some((l) => l.title.toLowerCase().includes(q))
      })
      .map((c) => {
        const lessons = c.lessons.filter((l) => l.title.toLowerCase().includes(q))
        return lessons.length > 0 && lessons.length < c.lessons.length ? { ...c, lessons } : c
      })
  }, [orderedTree, debouncedQuery])

  // M2 批 A: 「我的学习」三组派生（已提取按最近任务时间倒序）。
  const mineCourses = useMemo(() => tree.filter((c) => c.isMine === true), [tree])
  const extractedCourses = useMemo(
    () =>
      tree
        .filter((c) => c.hasExtracted === true && c.isMine !== true)
        .sort((a, b) => (b.lastTaskAt ?? '').localeCompare(a.lastTaskAt ?? '')),
    [tree]
  )
  const sameCourses = useMemo(
    () =>
      orderedTree.tree.filter(
        (c) => orderedTree.sameCourseIds.has(c.id) && c.isMine !== true && c.hasExtracted !== true
      ),
    [orderedTree]
  )

  const toggleAllCourses = useCallback((): void => setAllCoursesOpen((open) => !open), [])
  // M3-2: reveal the catalog in chunks — 2000 collapsed rows in one DOM is
  // the slow path the deep-audit flagged.
  const [visibleCourses, setVisibleCourses] = useState(150)
  useEffect(() => {
    setVisibleCourses(150)
  }, [searchMode])
  const showMoreCourses = useCallback((): void => setVisibleCourses((n) => n + 150), [])

  // V1.3: harvest a course's «第N节课» catalog from the play page. The main
  // window navigates away mid-call, so this is fire-and-forget: the fresh
  // mount after the harvest re-reads the local tree and shows the lessons.
  const harvestLessons = useCallback(
    (courseId: string): void => {
      confirmPlatformJump('harvest', () => {
        toast('正在打开播放页抓取课时目录，请稍候…')
        bridge.school
          .harvestLessons(courseId)
          .then(async () => applyLocalTree())
          .catch(() => undefined)
      })
    },
    [bridge, toast, applyLocalTree, confirmPlatformJump]
  )

  // C2: pin/unpin «my course»; re-read the local tree so the ordering applies.
  const toggleMine = useCallback(
    (courseId: string, mine: boolean): void => {
      void (async () => {
        const res = await bridge.school.setMine(courseId, mine)
        if (!res.ok) {
          toast(res.error ?? '操作失败', 'error')
          return
        }
        await applyLocalTree()
      })()
    },
    [bridge, toast, applyLocalTree]
  )

  const addManual = useCallback(
    (courseId: string, lessonId: string): void => {
      void (async () => {
        const res = await bridge.school.addManualCourse(courseId, lessonId)
        if (!res.ok) {
          toast(res.error ?? '添加失败', 'error')
          return
        }
        toast('已添加课程与课时', 'success')
        await refreshTree()
        selectLesson(lessonId)
      })()
    },
    [bridge, toast, refreshTree, selectLesson]
  )

  const launch = useCallback(
    async (taskId: string, queued: boolean): Promise<void> => {
      // B1: a queued task gets no progress card yet — the serial queue will
      // push progress events when its turn comes.
      if (!queued) {
        setProgress({ taskId, state: 'pending', stage: null, message: '排队中', percent: 0 })
        setRunning(true)
      }
      const res = await bridge.tasks.runAsync(taskId)
      if (!res.ok) {
        if (!queued) setRunning(false)
        toast(res.error ?? '启动失败', 'error')
      }
    },
    [bridge, toast]
  )

  /** B1: how many tasks are queued/running right now (from the latest rows). */
  const countActive = useCallback((): number => {
    return globalHistory.filter((row) => isActiveState(row.state)).length
  }, [globalHistory])

  const createAndRun = useCallback((): void => {
    if (currentLesson === '' || submitBusy) return
    // A1: validate capability bindings BEFORE creating the task — a missing
    // binding used to surface only at the summarizing stage (30+ min lost).
    const caps = new Set((providers?.bindings ?? []).map((b) => b.capability))
    const missing: string[] = []
    if (!caps.has('asr')) missing.push('ASR 转写')
    if (!caps.has('multimodal')) missing.push('多模态总结')
    if (missing.length > 0) {
      toast(`尚未绑定${missing.join('、')}模型，任务无法完成。请先在设置中配置 Provider。`, 'error', {
        actionLabel: '去设置',
        onAction: goSettings
      })
      return
    }
    // B1: queueing is allowed while a task runs — bounded, and one task per
    // lesson so the same video is never downloaded twice in parallel.
    const queued = running
    const activeCount = countActive()
    if (queued && activeCount >= 3) {
      toast('已有 3 个任务在排队/运行，等一个完成再排吧', 'error')
      return
    }
    if (globalHistory.some((row) => row.lesson_id === currentLesson && isActiveState(row.state))) {
      toast('该课时已有任务在排队/运行中', 'error')
      return
    }
    void (async () => {
      setSubmitBusy(true)
      try {
        const created = await bridge.tasks.create(currentLesson)
        if (!created.ok) {
          toast(created.error ?? '创建任务失败', 'error')
          return
        }
        await launch((created.value as { id: string }).id, queued)
        if (queued) {
          toast('已加入队列，当前任务完成后自动开始', 'success')
          await loadGlobalHistory()
        }
      } finally {
        setSubmitBusy(false)
      }
    })()
  }, [bridge, currentLesson, running, submitBusy, providers, toast, goSettings, launch, countActive, globalHistory, loadGlobalHistory])

  const retryTask = useCallback(
    (taskId: string): void => {
      if (running) return
      void launch(taskId, false)
    },
    [running, launch]
  )

  /** B5: cancel any queued/running task by id (row-level button too). */
  const cancelTask = useCallback(
    (taskId?: string): void => {
      const id = taskId ?? (running ? progress?.taskId : undefined)
      if (id == null) return
      void (async () => {
        const res = await bridge.tasks.cancel(id)
        if (!res.ok) {
          toast(res.error ?? '取消失败', 'error')
          return
        }
        await loadGlobalHistory()
        const lid = lessonRef.current
        if (lid !== '') void loadHistory(lid)
      })()
    },
    [bridge, running, progress, toast, loadGlobalHistory, loadHistory]
  )

  // M1-2: delete one terminal history row / clear all terminal rows, then
  // refresh the visible histories.
  const removeTask = useCallback(
    (taskId: string): void => {
      void (async () => {
        const res = await bridge.tasks.remove(taskId)
        if (!res.ok) {
          toast(res.error ?? '删除失败', 'error')
          return
        }
        await loadGlobalHistory()
        const lid = lessonRef.current
        if (lid !== '') void loadHistory(lid)
      })()
    },
    [bridge, toast, loadGlobalHistory, loadHistory]
  )

  const clearFinishedTasks = useCallback((): void => {
    void (async () => {
      const res = await bridge.tasks.clearFinished()
      if (!res.ok) {
        toast(res.error ?? '清理失败', 'error')
        return
      }
      toast(`已清理 ${res.value?.removed ?? 0} 条任务记录`, 'success')
      await loadGlobalHistory()
      const lid = lessonRef.current
      if (lid !== '') void loadHistory(lid)
    })()
  }, [bridge, toast, loadGlobalHistory, loadHistory])

  const ask = useCallback(
    (question: string): void => {
      const lid = lessonRef.current
      if (lid === '' || qaBusy) return
      void (async () => {
        setQaBusy(true)
        try {
          const res = await bridge.qa.ask(lid, question)
          const entry: QaEntry = res.ok
            ? { question, answer: (res.value as { answer: string }).answer }
            : { question, answer: `失败：${res.error ?? '未知错误'}` }
          setQaEntries((es) => [...es, entry])
          if (res.ok) void loadQaRecent()
        } finally {
          setQaBusy(false)
        }
      })()
    },
    [bridge, qaBusy, loadQaRecent]
  )

  const saveProvider = useCallback(
    (input: { name: string; baseUrl: string; apiKey: string; capability: string; model: string }): void => {
      void (async () => {
        setProviderBusy(true)
        try {
          const saved = await bridge.providers.save({ name: input.name, baseUrl: input.baseUrl, apiKey: input.apiKey })
          if (!saved.ok) {
            toast(saved.error ?? '保存失败', 'error')
            return
          }
          const bound = await bridge.providers.bind(input.capability, (saved.value as { id: string }).id, input.model)
          if (!bound.ok) {
            toast(bound.error ?? '绑定失败', 'error')
            return
          }
          toast(`已绑定 ${input.capability} → ${input.name}/${input.model}`, 'success')
          await refreshProviders()
        } finally {
          setProviderBusy(false)
        }
      })()
    },
    [bridge, toast, refreshProviders]
  )

  const removeProvider = useCallback(
    (id: string): void => {
      void (async () => {
        const res = await bridge.providers.remove(id)
        if (!res.ok) {
          toast(res.error ?? '删除失败', 'error')
          return
        }
        toast('已删除 Provider', 'success')
        await refreshProviders()
      })()
    },
    [bridge, toast, refreshProviders]
  )

  // M3 批 D: probe the form values against the endpoint (in-memory only).
  const [providerTest, setProviderTest] = useState<{ ok: boolean; text: string } | null>(null)
  const testProvider = useCallback(
    (input: { baseUrl: string; apiKey: string; model: string }): void => {
      void (async () => {
        setProviderTest({ ok: true, text: '测试中…' })
        const res = await bridge.providers.test(input)
        if (res.ok && res.value != null) {
          setProviderTest({ ok: true, text: `连接成功（${res.value.latencyMs}ms）` })
        } else {
          setProviderTest({ ok: false, text: `连接失败：${res.error ?? '未知错误'}` })
        }
      })()
    },
    [bridge]
  )

  const exportNote = useCallback(
    (lessonId: string): void => {
      void (async () => {
        const res = await bridge.notes.exportMarkdown(lessonId)
        if (!res.ok) {
          toast(res.error ?? '导出失败', 'error')
          return
        }
        if (res.value?.canceled) return
        toast(`已导出：${res.value?.path ?? ''}`, 'success')
      })()
    },
    [bridge, toast]
  )

  /** 2026-09-04 roadmap 2.2: Anki TSV decks — toast carries a reveal action. */
  const exportNoteAnki = useCallback(
    (lessonId: string): void => {
      void (async () => {
        const res = await bridge.notes.exportAnki(lessonId)
        if (!res.ok) {
          toast(res.error ?? '导出失败', 'error')
          return
        }
        const value = res.value
        if (value == null || value.canceled || value.paths.length === 0) return
        toast(`已导出 ${value.paths.length} 个牌堆文件`, 'success', {
          actionLabel: '打开所在文件夹',
          onAction: () => void bridge.notes.revealFile(value.paths[0] ?? '')
        })
      })()
    },
    [bridge, toast]
  )

  /** 2026-09-04: regenerate the note from stored transcripts/keyframes. */
  const regenerateNote = useCallback(
    (lessonId: string): void => {
      void (async () => {
        setNoteRegenBusy(true)
        try {
          const res = await bridge.notes.regenerate(lessonId)
          if (!res.ok) {
            toast(res.error ?? '重新生成失败', 'error')
            return
          }
          // Citation quality signal (roadmap 1.3): hidden when nothing cited.
          const result = res.value
          if (result == null) {
            toast('重新生成失败：返回数据缺失', 'error')
            return
          }
          const hitSuffix = result.hitRate.total > 0 ? `，引用命中 ${result.hitRate.hits}/${result.hitRate.total}` : ''
          toast(`已生成第 ${result.version} 版笔记${hitSuffix}`, 'success')
          await loadNote(lessonId)
          await loadNoteIndex()
        } finally {
          setNoteRegenBusy(false)
        }
      })()
    },
    [bridge, toast, loadNote, loadNoteIndex]
  )

  /** 2026-09-04: full-lesson PDF handout (cover → mind map → body → gallery). */
  const exportNotePdf = useCallback(
    (lessonId: string): void => {
      void (async () => {
        if (note == null) return
        setPdfBusy(true)
        const printRoot = document.getElementById('print-root')
        try {
          const dialog = await bridge.notes.exportPdfDialog(lessonId)
          if (!dialog.ok) {
            toast(dialog.error ?? '导出失败', 'error')
            return
          }
          if (dialog.value?.canceled || dialog.value?.path == null) return

          const course = tree.find((c) => c.lessons.some((l) => l.id === lessonId))
          const lessonInfo = course?.lessons.find((l) => l.id === lessonId)
          // Render the handout, then let every image decode before printing.
          render(
            <PrintHandout
              note={note}
              attachments={attachments}
              courseName={course?.name ?? ''}
              lessonTitle={lessonInfo?.title ?? lessonId}
              teacher={course?.teacher}
              courTimes={course?.courTimes}
              classroom={course?.classroom}
              generatedAt={new Date().toLocaleString('zh-CN')}
            />,
            printRoot!
          )
          await waitForImages(printRoot!)
          const res = await bridge.notes.exportPdfWrite(dialog.value.path)
          if (!res.ok) {
            toast(res.error ?? 'PDF 生成失败', 'error')
            return
          }
          const filePath = res.value?.path ?? ''
          toast(
            `已导出 PDF（${Math.round((res.value?.bytes ?? 0) / 1024)} KB）：${filePath}`,
            'success',
            {
              actionLabel: '打开所在文件夹',
              onAction: () => {
                void bridge.notes.revealFile(filePath)
              }
            }
          )
        } finally {
          render(null, printRoot!)
          setPdfBusy(false)
        }
      })()
    },
    [bridge, toast, note, attachments, tree]
  )

  const copyNote = useCallback((): void => {
    if (note == null) return
    void navigator.clipboard
      .writeText(noteToMarkdown(note, '课程笔记'))
      .then(() => toast('已复制 Markdown 到剪贴板', 'success'))
      .catch(() => toast('复制失败', 'error'))
  }, [note, tree, currentLesson, toast])

  const setCacheDir = useCallback(
    (dir: string): void => {
      void (async () => {
        const res = await bridge.settings.setCacheDir(dir)
        if (!res.ok) {
          toast(res.error ?? '设置失败', 'error')
          return
        }
        toast('缓存目录已更新，新任务将写入新位置', 'success')
        await refreshSettings()
      })()
    },
    [bridge, toast, refreshSettings]
  )

  const setTheme = useCallback(
    (theme: 'auto' | 'light' | 'dark'): void => {
      void (async () => {
        const res = await bridge.settings.setTheme(theme)
        if (!res.ok) {
          toast(res.error ?? '设置失败', 'error')
          return
        }
        await refreshSettings()
      })()
    },
    [bridge, toast, refreshSettings]
  )

  const chooseLibrary = useCallback((): void => {
    void (async () => {
      const res = await bridge.settings.chooseLibrary()
      if (!res.ok) {
        toast(res.error ?? '迁移失败', 'error')
        return
      }
      if (res.value?.canceled) return
      toast(`资料库已迁移，重启应用后生效`, 'success')
      await refreshSettings()
    })()
  }, [bridge, toast, refreshSettings])

  const openPath = useCallback(
    (kind: 'library' | 'cache' | 'exports' | 'logs'): void => {
      void bridge.settings.openPath(kind)
    },
    [bridge]
  )

  // Renderer errors reach the same redacted file log (U5).
  useEffect(() => {
    const report = (message: string): void => {
      void bridge.log.rendererError(message)
    }
    const onError = (event: ErrorEvent): void => report(event.message ?? 'unknown error')
    const onRejection = (event: PromiseRejectionEvent): void => report(`unhandled rejection: ${String(event.reason)}`)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [bridge])

  return {
    session,
    sessionInfo,
    sessionBusy,
    refreshBusy,
    refreshMeta,
    refreshProgress,
    tree,
    filteredTree,
    treeLoaded,
    expanded,
    query,
    searchMode,
    currentLesson,
    sameCourseIds: orderedTree.sameCourseIds,
    mineCourses,
    lessonContext,
    lessonContextOrIndex,
    lessonNeighbors,
    jumpConfirm,
    acceptJump,
    dismissJump,
    extractedCourses,
    sameCourses,
    allCoursesOpen,
    toggleAllCourses,
    visibleCourses,
    showMoreCourses,
    note,
    noteIndex,
    qaRecent,
    harvestInflight,
    openLessonNotes,
    history,
    globalHistory,
    progress,
    running,
    submitBusy,
    qaEntries,
    qaBusy,
    providers,
    providerBusy,
    settings,
    toasts,
    login,
    logout,
    refreshTree,
    toggleCourse,
    expandAll,
    collapseAll,
    setQuery,
    harvestLessons,
    toggleMine,
    selectLesson,
    addManual,
    createAndRun,
    retryTask,
    cancelTask,
    removeTask,
    clearFinishedTasks,
    ask,
    saveProvider,
    removeProvider,
    testProvider,
    providerTest,
    exportNote,
    exportNoteAnki,
    copyNote,
    attachments,
    noteRegenBusy,
    regenerateNote,
    pdfBusy,
    exportNotePdf,
    setCacheDir,
    setTheme,
    chooseLibrary,
    openPath
  }
}
