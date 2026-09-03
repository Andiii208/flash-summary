import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { AppSettingsInfo, CourseTreeInfo, ProvidersListResult, SeuSummaryBridge, TaskProgressInfo, TaskRowInfo } from '../shared/bridge'
import type { Note } from '../shared/notes/schema'
import { noteToMarkdown } from '../shared/notes/markdown'
import { withSessionRetry } from '../shared/session-retry'
import { orderMyCoursesFirst } from '../shared/course-order'
import type { ApiResult } from '../shared/api-result'
import { CourseTree } from './components/CourseTree'
import { TaskPanel } from './components/TaskPanel'
import { NoteViewer } from './components/NoteViewer'
import { QaPanel, type QaEntry } from './components/QaPanel'
import { TopBar, type SessionState } from './components/TopBar'
import { ToastArea, type ToastItem, type ToastKind } from './components/ToastArea'
import { WelcomeGuide } from './components/WelcomeGuide'
import { ManualAdd } from './components/ManualAdd'
import { SettingsPanel } from './components/SettingsPanel'

type MainTab = 'tasks' | 'notes' | 'qa' | 'settings'

/** school:listCourses envelope value (paged refresh, B1). */
type CourseListResult = { loaded: number; platformTotal: number; platformPages: number }

const TAB_LABELS: Array<{ id: MainTab; label: string }> = [
  { id: 'tasks', label: '任务' },
  { id: 'notes', label: '笔记' },
  { id: 'qa', label: '追问' },
  { id: 'settings', label: '设置' }
]

export function App({ bridge }: { bridge: SeuSummaryBridge }): JSX.Element {
  const state = useAppState(bridge)
  const [tab, setTab] = useState<MainTab>('tasks')
  const showWelcome = state.treeLoaded && state.tree.length === 0

  return (
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
          {state.tree.length > 0 && state.refreshMeta != null && (
            <p class="tree-meta">
              已加载 {state.refreshMeta.loaded} 门 / 全校约 {state.refreshMeta.platformTotal} 门（搜索仅覆盖已加载课程）
            </p>
          )}
          {state.tree.length > 0 && (
            <>
              <input
                class="search-input"
                type="search"
                placeholder="搜索课程 / 教师 / 学期…"
                value={state.query}
                onInput={(e) => state.setQuery((e.target as HTMLInputElement).value)}
              />
              <div class="tree-tools">
                <button class="btn small ghost" onClick={state.expandAll}>
                  全部展开
                </button>
                <button class="btn small ghost" onClick={state.collapseAll}>
                  全部收起
                </button>
              </div>
            </>
          )}
          {showWelcome ? (
            <WelcomeGuide onLogin={state.login} onOpenSettings={() => setTab('settings')} busy={state.sessionBusy} />
          ) : (
            <CourseTree
              tree={state.filteredTree}
              selectedLesson={state.currentLesson}
              expanded={state.expanded}
              searching={state.query.trim() !== ''}
              sameCourseIds={state.sameCourseIds}
              onToggle={state.toggleCourse}
              onSelect={state.selectLesson}
              onHarvestLessons={state.harvestLessons}
              onToggleMine={state.toggleMine}
            />
          )}
          <ManualAdd onAdd={state.addManual} />
        </aside>
        <main class="content">
          <nav class="tabs" role="tablist">
            {TAB_LABELS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          {tab === 'tasks' && (
            <TaskPanel
              currentLesson={state.currentLesson}
              running={state.running}
              busy={state.submitBusy}
              progress={state.progress}
              history={state.history}
              globalHistory={state.globalHistory}
              onCreateRun={state.createAndRun}
              onRetry={state.retryTask}
              onCancel={state.cancelTask}
            />
          )}
          {tab === 'notes' && (
            <NoteViewer note={state.note} onExport={state.currentLesson !== '' ? () => state.exportNote(state.currentLesson) : undefined} onCopy={state.copyNote} />
          )}
          {tab === 'qa' && <QaPanel entries={state.qaEntries} busy={state.qaBusy} hasLesson={state.currentLesson !== ''} onAsk={state.ask} />}
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
              onSetCacheDir={state.setCacheDir}
              onSetTheme={state.setTheme}
              onChooseLibrary={state.chooseLibrary}
              onOpenPath={state.openPath}
            />
          )}
        </main>
      </div>
    </div>
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
  currentLesson: string
  /** Same-subject sections of pinned courses, for the «同课» badge (C4). */
  sameCourseIds: ReadonlySet<string>
  note: Note | null
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
  createAndRun: () => void
  retryTask: (taskId: string) => void
  cancelTask: () => void
  ask: (question: string) => void
  saveProvider: (input: { name: string; baseUrl: string; apiKey: string; capability: string; model: string }) => void
  removeProvider: (id: string) => void
  exportNote: (lessonId: string) => void
  copyNote: () => void
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

function useAppState(bridge: SeuSummaryBridge): AppState {
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [currentLesson, setCurrentLesson] = useState('')
  const [note, setNote] = useState<Note | null>(null)
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

  const toast = useCallback((message: string, kind: ToastKind = 'info'): void => {
    const id = ++toastId.current
    setToasts((ts) => [...ts, { id, message, kind }])
    const ms = kind === 'error' ? 6500 : 3500
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), ms)
  }, [])

  const applyLocalTree = useCallback(async (): Promise<void> => {
    const res = await bridge.school.courseTree()
    if (res.ok && res.value != null) {
      setTree(res.value)
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
        setRunning(false)
        toast(`任务 ${p.taskId} 完成`, 'success')
        if (lid !== '') {
          void loadNote(lid)
          void loadHistory(lid)
        }
      } else if (p.state === 'failed') {
        setRunning(false)
        toast(p.message, 'error')
        if (p.kind === 'session_expired') toast('会话已过期，登录后可重试此任务', 'error')
      }
    })
    return () => {
      disposed = true
      off()
    }
  }, [bridge, toast, applyLocalTree, refreshProviders, refreshSettings, loadNote, loadHistory, loadGlobalHistory, refreshTree])

  const login = useCallback((): void => {
    if (sessionBusy) return // one login at a time (stacked windows field case 2026-09-01)
    void (async () => {
      // A5 preflight: a Fake-IP takeover fails the platform page before it
      // loads — explain the fix instead of leaving a dead window.
      if (!(await ensureCampusNet())) return
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
  }, [bridge, toast, refreshTree, sessionBusy, ensureCampusNet])

  const logout = useCallback((): void => {
    void bridge.school.logout()
    setSession('logged_out')
    setTree([])
    setCurrentLesson('')
    setNote(null)
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

  const filteredTree = useMemo<CourseTreeInfo[]>(() => {
    const q = query.trim().toLowerCase()
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
  }, [orderedTree, query])

  // V1.3: harvest a course's «第N节课» catalog from the play page. The main
  // window navigates away mid-call, so this is fire-and-forget: the fresh
  // mount after the harvest re-reads the local tree and shows the lessons.
  const harvestLessons = useCallback(
    (courseId: string): void => {
      toast('正在打开播放页抓取课时目录，请稍候…')
      bridge.school
        .harvestLessons(courseId)
        .then(async () => applyLocalTree())
        .catch(() => undefined)
    },
    [bridge, toast, applyLocalTree]
  )

  const selectLesson = useCallback(
    (lessonId: string): void => {
      setCurrentLesson(lessonId)
      lessonRef.current = lessonId
      setQaEntries([])
      void loadNote(lessonId)
      void loadHistory(lessonId)
      void loadQaHistory(lessonId)
    },
    [loadNote, loadHistory, loadQaHistory]
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
    async (taskId: string): Promise<void> => {
      setProgress({ taskId, state: 'pending', stage: null, message: '排队中', percent: 0 })
      setRunning(true)
      const res = await bridge.tasks.runAsync(taskId)
      if (!res.ok) {
        setRunning(false)
        toast(res.error ?? '启动失败', 'error')
      }
    },
    [bridge, toast]
  )

  const createAndRun = useCallback((): void => {
    if (currentLesson === '' || running) return
    void (async () => {
      setSubmitBusy(true)
      try {
        const created = await bridge.tasks.create(currentLesson)
        if (!created.ok) {
          toast(created.error ?? '创建任务失败', 'error')
          return
        }
        await launch((created.value as { id: string }).id)
      } finally {
        setSubmitBusy(false)
      }
    })()
  }, [bridge, currentLesson, running, toast, launch])

  const retryTask = useCallback(
    (taskId: string): void => {
      if (running) return
      void launch(taskId)
    },
    [running, launch]
  )

  const cancelTask = useCallback((): void => {
    if (!running) return
    const id = progress?.taskId
    if (id == null) return
    void bridge.tasks.cancel(id)
  }, [bridge, running, progress])

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
        } finally {
          setQaBusy(false)
        }
      })()
    },
    [bridge, qaBusy]
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
    currentLesson,
    sameCourseIds: orderedTree.sameCourseIds,
    note,
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
    ask,
    saveProvider,
    removeProvider,
    exportNote,
    copyNote,
    setCacheDir,
    setTheme,
    chooseLibrary,
    openPath
  }
}
