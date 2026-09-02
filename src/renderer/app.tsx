import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { AppSettingsInfo, CourseTreeInfo, ProvidersListResult, SeuSummaryBridge, TaskProgressInfo, TaskRowInfo } from '../shared/bridge'
import type { Note } from '../shared/notes/schema'
import { withSessionRetry } from '../shared/session-retry'
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
      <TopBar session={state.session} busy={state.sessionBusy} onLogin={state.login} onLogout={state.logout} />
      <ToastArea toasts={state.toasts} />
      <div class="app-main">
        <aside class="sidebar">
          <h2>课程</h2>
          <button class="btn small" onClick={state.refreshTree}>
            刷新课程
          </button>
          {showWelcome ? (
            <WelcomeGuide onLogin={state.login} onOpenSettings={() => setTab('settings')} busy={state.sessionBusy} />
          ) : (
            <CourseTree
              tree={state.tree}
              selectedLesson={state.currentLesson}
              collapsed={state.collapsed}
              onToggle={state.toggleCourse}
              onSelect={state.selectLesson}
              onHarvestLessons={state.harvestLessons}
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
              onCreateRun={state.createAndRun}
              onRetry={state.retryTask}
              onCancel={state.cancelTask}
            />
          )}
          {tab === 'notes' && <NoteViewer note={state.note} onExport={state.currentLesson !== '' ? () => state.exportNote(state.currentLesson) : undefined} />}
          {tab === 'qa' && <QaPanel entries={state.qaEntries} busy={state.qaBusy} onAsk={state.ask} />}
          {tab === 'settings' && (
            <SettingsPanel
              settings={state.settings}
              session={state.session}
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
  sessionBusy: boolean
  tree: CourseTreeInfo[]
  treeLoaded: boolean
  collapsed: ReadonlySet<string>
  currentLesson: string
  note: Note | null
  history: TaskRowInfo[]
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
  harvestLessons: (courseId: string) => void
  selectLesson: (lessonId: string) => void
  addManual: (courseId: string, lessonId: string) => void
  createAndRun: () => void
  retryTask: (taskId: string) => void
  cancelTask: () => void
  ask: (question: string) => void
  saveProvider: (input: { name: string; baseUrl: string; apiKey: string; capability: string; model: string }) => void
  removeProvider: (id: string) => void
  exportNote: (lessonId: string) => void
  setCacheDir: (dir: string) => void
  setTheme: (theme: 'auto' | 'light' | 'dark') => void
  chooseLibrary: () => void
  openPath: (kind: 'library' | 'cache' | 'exports' | 'logs') => void
}

function useAppState(bridge: SeuSummaryBridge): AppState {
  const [session, setSession] = useState<SessionState>('logged_out')
  const [sessionBusy, setSessionBusy] = useState(false)
  const [tree, setTree] = useState<CourseTreeInfo[]>([])
  const [treeLoaded, setTreeLoaded] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [currentLesson, setCurrentLesson] = useState('')
  const [note, setNote] = useState<Note | null>(null)
  const [history, setHistory] = useState<TaskRowInfo[]>([])
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

  const refreshTree = useCallback(async (): Promise<void> => {
    // User-triggered refresh (spec §2): on session expiry the renderer opens
    // the CAS login once and retries the course list.
    const list = (await withSessionRetry(
      () => bridge.school.listCourses() as Promise<ApiResult<CourseTreeInfo[]>>,
      () => bridge.school.login()
    )) as ApiResult<CourseTreeInfo[]>
    if (!list.ok && list.kind === 'session_expired') {
      setSession('logged_out')
      toast('会话已过期，请重新登录', 'error')
    }
    await applyLocalTree()
  }, [bridge, toast, applyLocalTree])

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

  useEffect(() => {
    let disposed = false
    void (async () => {
      const s = await bridge.school.session()
      if (!disposed && s.ok && s.value != null && s.value.state === 'logged_in') setSession('logged_in')
    })()
    // Mount reads the local tree only: a mount-time listCourses on an expired
    // session auto-opened the CAS login window via withSessionRetry, which
    // read as "the app did nothing" (field case 2026-09-01). Network refresh
    // stays behind the explicit 刷新课程 button.
    void applyLocalTree()
    void refreshProviders()
    void refreshSettings()
    const off = bridge.tasks.onProgress((p) => {
      setProgress(p)
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
  }, [bridge, toast, applyLocalTree, refreshProviders, refreshSettings, loadNote, loadHistory])

  const login = useCallback((): void => {
    if (sessionBusy) return // one login window at a time (stacked windows field case 2026-09-01)
    void (async () => {
      setSessionBusy(true)
      try {
        const res = await bridge.school.login()
        if (!res.ok) {
          toast(res.error ?? '登录失败', 'error')
          return
        }
        setSession('logged_in')
        toast('登录成功', 'success')
        await refreshTree()
      } finally {
        setSessionBusy(false)
      }
    })()
  }, [bridge, toast, refreshTree, sessionBusy])

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
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(courseId)) next.delete(courseId)
      else next.add(courseId)
      return next
    })
  }, [])

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
    sessionBusy,
    tree,
    treeLoaded,
    collapsed,
    currentLesson,
    note,
    history,
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
    harvestLessons,
    selectLesson,
    addManual,
    createAndRun,
    retryTask,
    cancelTask,
    ask,
    saveProvider,
    removeProvider,
    exportNote,
    setCacheDir,
    setTheme,
    chooseLibrary,
    openPath
  }
}
