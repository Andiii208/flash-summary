import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { ChevronDown, ChevronRight, Maximize2, PanelLeftClose, PanelLeftOpen } from 'lucide-preact'
import type { AppSettingsInfo, CourseTreeInfo, ProvidersListResult, QaRecentInfo, SeuSummaryBridge, TaskRowInfo } from '../shared/bridge'
import type { Note } from '../shared/notes/schema'
import { withSessionRetry } from '../shared/session-retry'
import { orderMyCoursesFirst, orderTreeLessonsByNumber } from '../shared/course-order'
import { courseMatchesQuery } from '../shared/course-search'
import type { ApiResult } from '../shared/api-result'
import { CourseTree } from './components/CourseTree'
import { CourseBrowser } from './components/CourseBrowser'
import { MyStudyPanel } from './components/MyStudyPanel'
import { TaskPanel } from './components/TaskPanel'
import { NoteViewer, type LessonContext } from './components/NoteViewer'
import { QaPanel, type QaEntry } from './components/QaPanel'
import { TopBar, type SessionState } from './components/TopBar'
import { ToastArea, type ToastItem, type ToastKind } from './components/ToastArea'
import type { LessonChipLesson } from './components/LessonChip'
import { Dialog } from './ui/Dialog'
import { CourseMapDialog } from './components/CourseMapDialog'
import { NoteUpgradeDialog } from './components/NoteUpgradeDialog'
import { WelcomeGuide } from './components/WelcomeGuide'
import { PageHeader } from './components/PageHeader'
import { ManualAdd } from './components/ManualAdd'
import { BiliImportDialog } from './components/BiliImportDialog'
import { ConsentDialog } from './components/ConsentDialog'
import { CopyrightNoticeDialog } from './components/CopyrightNoticeDialog'
import { FeedbackDiagnosticsDialog } from './components/FeedbackDiagnosticsDialog'
import { useToasts } from './hooks/use-toasts'
import { useConfigDomain } from './hooks/use-config-domain'
import { useNotesDomain, type NotesDomain } from './hooks/use-notes-domain'
import { useTasksDomain, isActiveState, type TasksDomain } from './hooks/use-tasks-domain'
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

/** 批F: Ctrl+1..4 → tab id (null when the chord doesn't map to a tab). */
export function tabForHotkey(key: string, modifiers: { ctrl: boolean; alt: boolean; meta: boolean; shift: boolean }): MainTab | null {
  if (!modifiers.ctrl || modifiers.alt || modifiers.meta || modifiers.shift) return null
  const entry = TAB_LABELS[Number(key) - 1]
  if (entry == null || String(Number(key)) !== key) return null
  return entry.id
}

/**
 * A4 (plan 2026-09-13): the sidebar meta line, keeping three easily-confused
 * numbers apart — the LAST refresh's yield, the platform's page-count
 * approximation, and the local catalog (which accumulates across refreshes,
 * so «已加载 0 门» next to a four-digit catalog is normal, not a bug).
 * D2: while a paged refresh runs, its page progress also lives here so the
 * header button can hold a fixed-width «刷新中…». Null → render nothing
 * (fresh install, never refreshed).
 */
export function sidebarMetaLine(
  refreshBusy: boolean,
  progress: { page: number; pageCount: number } | null,
  meta: { loaded: number; platformTotal: number } | null,
  catalogCount: number
): string | null {
  if (refreshBusy) {
    const at = progress != null ? `第 ${progress.page}/${progress.pageCount} 页` : ''
    return `正在刷新${at}… · 本地已收录 ${catalogCount} 门`
  }
  if (meta == null) return null
  // ok-envelope with an empty list: state the fact, point at the usual cause
  // (soft-expired session returns a valid but empty payload) without claiming it.
  const empty = meta.loaded === 0 ? '——平台返回了空列表，可重新登录后再试' : ''
  return `本地已收录 ${catalogCount} 门 · 本次刷新 ${meta.loaded} 门${empty} · 平台列表约 ${meta.platformTotal} 门（搜索只查本地已收录的课）`
}

/** 批C: sidebar/context persistence — the harvest and login flows navigate
 *  the main window away, which unloads this renderer; without persistence
 *  the user lands back at the top of a collapsed tree (field 2026-09-04).
 *  sessionStorage (2026-09-05): the snapshot must survive those same-window
 *  navigations but NOT a cold start — opening the app always lands on the
 *  clean home view (no lesson, tasks tab), per the 2026-09-05 UX plan. */
const UI_STATE_KEY = 'seu-summary.ui-state.v1'
const HARVEST_SEQ_KEY = 'seu-summary.harvest-seq.v1'

interface PersistedUiState {
  expanded: string[]
  currentLesson: string
  allCoursesOpen: boolean
  tab: MainTab
  sidebarCollapsed: boolean
}

function loadPersistedUi(): Partial<PersistedUiState> {
  try {
    const raw = window.sessionStorage.getItem(UI_STATE_KEY)
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
    window.sessionStorage.setItem(UI_STATE_KEY, JSON.stringify(next))
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
  const state = useAppState(bridge, goTasks, goNotes, goSettings, setTab)
  const sidebarRef = useRef<HTMLElement>(null)
  // 健康巡查 2026-09-12 批8 (遗留清单⑫): the sidebar is collapsible — a
  // narrow window should not donate 304px permanently. The choice rides the
  // UI snapshot, so a harvest/login round-trip keeps it.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadPersistedUi().sidebarCollapsed ?? false)
  const toggleSidebar = useCallback((): void => setSidebarCollapsed((prev) => !prev), [])
  useEffect(() => {
    savePersistedUi({ sidebarCollapsed })
  }, [sidebarCollapsed])
  // 批5 (plan 2026-09-18): 窄窗（≤1024）默认收起侧栏，把 304px 让给内容列。
  // 只在挂载时判定一次——监听 resize 会在用户手动展开后把它再次收走。
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    if (window.matchMedia('(max-width: 1024px)').matches) setSidebarCollapsed(true)
  }, [])
  // 批4 (plan 2026-09-13): fullscreen course browser — opened from the
  // «全部课程» row's icon button or Ctrl+K (D6). Transient, never persisted:
  // a harvest/login round-trip landing on a full-screen overlay would hide
  // the login state the user navigated for.
  const [courseBrowserOpen, setCourseBrowserOpen] = useState(false)
  const closeCourseBrowser = useCallback((): void => setCourseBrowserOpen(false), [])
  const showWelcome = state.treeLoaded && state.tree.length === 0

  // 声明批2 (plan 2026-09-11): nothing renders before the 使用须知 gate is
  // satisfied. The decision comes from main (settings:get compares the stored
  // acceptance against the shared text version), never from a local flag — so
  // bumping the text re-prompts on the next launch.
  //
  // Three states and no fourth: settings unreadable → wait, or offer a retry
  // when the read actually failed. A gate that quietly lets the app through
  // because a read errored is not a gate.
  if (state.settings == null) {
    return (
      <div class="consent-boot" data-testid="consent-boot">
        {state.configLoadError.settings == null ? (
          <p>正在加载设置…</p>
        ) : (
          <>
            <p>无法读取设置，因此无法确认使用须知状态：{state.configLoadError.settings}</p>
            <button class="btn" onClick={state.retryConfigLoad}>
              重试
            </button>
          </>
        )}
      </div>
    )
  }
  if (state.settings.disclaimerAccepted !== true) {
    return (
      <ConsentDialog
        onAccept={state.acceptDisclaimer}
        // A real quit, not «稍后再说»: main's close handler only intercepts
        // while a task is running (impossible at the gate), after which
        // window-all-closed runs app.quit() as usual.
        onExit={() => window.close()}
      />
    )
  }

  // 批F: Ctrl+1..4 switch the four tabs (desktop convention).
  // 批4 (plan 2026-09-13): Ctrl+K toggles the fullscreen course browser (D6);
  // the chord is free (the app menu defines no accelerators).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCourseBrowserOpen((open) => !open)
        return
      }
      const next = tabForHotkey(e.key, { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey })
      if (next == null) return
      e.preventDefault()
      setTab(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setTab])

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
      {/* 声明批4: 导出前的版权提醒（spec §9 承诺的兑现）。 */}
      <CopyrightNoticeDialog
        open={state.exportNotice != null}
        remember={state.exportNotice?.remember ?? false}
        onRememberChange={state.setExportNoticeRemember}
        onConfirm={state.confirmExportNotice}
        onCancel={state.cancelExportNotice}
      />
      {/* 声明批6: «反馈这个错误» 弹层。诊断文本已过 main 的 redact，只复制到本地剪贴板。 */}
      <FeedbackDiagnosticsDialog
        open={state.feedbackReport != null}
        busy={state.feedbackReport?.busy ?? false}
        text={state.feedbackReport?.text ?? ''}
        onCopy={state.copyReport}
        onClose={state.closeReport}
      />
      <div class="app-shell">
      <TopBar
        session={state.session}
        biliSession={state.biliSession}
        busy={state.sessionBusy}
        running={state.running}
        onLogin={state.login}
        onLogout={state.logout}
        onOpenBili={state.openBili}
        onOpenTasks={goTasks}
        onHome={() => {
          state.goHome()
          sidebarRef.current?.scrollTo({ top: 0 })
        }}
        breadcrumb={state.lessonContextOrIndex != null ? { courseName: state.lessonContextOrIndex.courseName, lessonTitle: state.lessonContextOrIndex.lessonTitle } : null}
        onClearLesson={state.clearLesson}
      />
      <ToastArea toasts={state.toasts} onDismiss={state.dismissToast} />
      <NoteUpgradeDialog
        open={state.noteUpgrade.open}
        courseLabel={state.noteUpgrade.label}
        loading={state.noteUpgrade.loading}
        items={state.noteUpgrade.items}
        busy={state.noteUpgradeRun.busy}
        statusOf={(lessonId) =>
          state.noteUpgradeRun.running.has(lessonId)
            ? ('running' as const)
            : state.noteUpgradeRun.done.has(lessonId)
              ? ('done' as const)
              : state.noteUpgradeRun.failed.has(lessonId)
                ? ('failed' as const)
                : ('idle' as const)
        }
        // 批2 (plan 2026-09-20, P4): 每行失败原因就地可见（main 侧守卫的原文）。
        reasonOf={(lessonId) => state.noteUpgradeRun.failed.get(lessonId)}
        onRun={state.runNoteUpgrade}
        onClose={state.closeNoteUpgrade}
      />
      <BiliImportDialog
        bridge={bridge}
        open={state.biliDialogOpen}
        sessionState={state.biliSession}
        onSessionRefresh={state.refreshBiliSession}
        onLogout={state.biliLogout}
        onImported={state.biliImported}
        onClose={state.closeBili}
        toast={state.toast}
      />
      {/* 批4 (plan 2026-09-13): fullscreen course browser (D5-A near-fullscreen modal).
          批5: full handler parity with the sidebar rows (star/map/harvest/delete,
          lesson pick closes the browser and lands the selection). */}
      <CourseBrowser
        open={courseBrowserOpen}
        tree={state.tree}
        selectedLessonId={state.currentLesson}
        onSelectLesson={state.selectLesson}
        onToggleMine={state.toggleMine}
        onHarvestLessons={state.harvestLessons}
        onRemoveCourse={state.removeCourse}
        // 批1 (plan 2026-09-20, P13): the three self-drawn overlays share
        // z-index 40, so DOM order decides — the browser used to cover the
        // map dialog completely (the user clicked 导图 and saw nothing).
        // Close first, then open: same convention as picking a lesson.
        onCourseMap={(courseId) => {
          closeCourseBrowser()
          state.openCourseMap(courseId)
        }}
        harvestInflight={state.harvestInflight}
        courseMapBusy={state.courseMapBusy}
        onClose={closeCourseBrowser}
      />
      {/* 批1 (P13): rendered AFTER the browser as a defensive backstop — any
          future path that opens the map while the browser is up still lands on
          top instead of behind. z-index untouched (the three overlays stay
          peers; the shared confirm layer is a different tier). */}
      {state.courseMap != null && <CourseMapDialog info={state.courseMap} onClose={state.closeCourseMap} />}
      <div class="app-main">
        <aside class={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`} ref={sidebarRef}>
          {/* A1 (plan 2026-09-13): the toggle lives at the END of the header
              row. It used to be the aside's first flex child, which gave a
              lone 24px icon its own full row above «课程» (+34px of height). */}
          <div class="sidebar-head">
            <h2>课程</h2>
            <div class="sidebar-head-actions">
              {/* 批1 双源并列: B站导入与「刷新课程」同层同级。 */}
              <button class="btn small ghost" onClick={state.openBili} title="粘贴B站视频链接，解析后导入生成笔记">
                导入 B站视频
              </button>
              <button
                class="btn small ghost"
                onClick={state.refreshTree}
                disabled={state.session === 'logged_out' || state.refreshBusy}
              >
                {/* D2 (plan 2026-09-13): fixed-width busy label — the paged
                    progress «第 N/M 页» moved to the meta line below, its old
                    spot here overflowed the one-row header (measured 289px
                    against a 269px content box) and clipped this toggle. */}
                {state.refreshBusy ? '刷新中…' : '刷新课程'}
              </button>
            </div>
            <button
              class="sidebar-collapse"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? '展开课程侧栏' : '收起课程侧栏'}
              title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={15} strokeWidth={1.75} /> : <PanelLeftClose size={15} strokeWidth={1.75} />}
            </button>
          </div>
          {state.tree.length > 0 && (
            <input
              class="search-input"
              type="search"
              placeholder="搜索课程 / 教师 / 学期…"
              aria-label="搜索课程"
              value={state.query}
              onInput={(e) => state.setQuery((e.target as HTMLInputElement).value)}
            />
          )}
          {/* A4/D2 (plan 2026-09-13): three numbers that must not be conflated —
              the last refresh's yield, the platform's page-count approximation,
              and the local catalog (which ACCUMULATES across refreshes: field
              case showed «已加载 0 门 / 全校约 500 门» directly above a 1314-row
              catalog). The refresh page progress also lives here (D2). */}
          {(() => {
            const metaLine = sidebarMetaLine(state.refreshBusy, state.refreshProgress, state.refreshMeta, state.tree.length)
            return metaLine != null ? <p class="tree-meta" data-testid="tree-meta">{metaLine}</p> : null
          })()}
          {showWelcome ? (
            <WelcomeGuide onLogin={state.login} onOpenBili={state.openBili} onOpenSettings={() => setTab('settings')} busy={state.sessionBusy} />
          ) : state.searchMode ? (
            <>
            <CourseTree
              tree={state.filteredTree.slice(0, state.visibleCourses)}
              selectedLesson={state.currentLesson}
              expanded={state.expanded}
              searching
              sameCourseIds={state.sameCourseIds}
              harvestInflight={state.harvestInflight}
              courseMapBusy={state.courseMapBusy}
              onRemoveCourse={state.removeCourse}
              onCourseMap={state.openCourseMap}
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
          ) : (
            <>
              <MyStudyPanel
                mine={state.mineCourses}
                extracted={state.extractedCourses}
                sameCourses={state.sameCourses}
                selectedLesson={state.currentLesson}
                expanded={state.expanded}
                courseMapBusy={state.courseMapBusy}
                onRemoveCourse={state.removeCourse}
                onCourseMap={state.openCourseMap}
                onToggle={state.toggleCourse}
                onSelect={state.selectLesson}
                onHarvestLessons={state.harvestLessons}
                onToggleMine={state.toggleMine}
              />
              <section class="all-courses">
                <div class="all-courses-row">
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
                  {/* 批4 (plan 2026-09-13): fullscreen browser entry (D6-A). */}
                  <button
                    class="course-browser-open"
                    data-testid="course-browser-open"
                    title="全屏浏览全部课程（Ctrl+K）"
                    aria-label="全屏浏览全部课程"
                    onClick={() => setCourseBrowserOpen(true)}
                  >
                    <Maximize2 size={13} strokeWidth={1.75} />
                  </button>
                </div>
                {state.allCoursesOpen && (
                  <>
                    <div class="tree-tools">
                      {/* 批6 (T39): 三处展开/收起统一为「由少到多」的同一顺序
                          （全部收起 → … → 全部展开），与导图的深度控制同向。 */}
                      <button class="btn small ghost" onClick={state.collapseAll}>
                        全部收起
                      </button>
                      <button class="btn small ghost" onClick={state.expandAll}>
                        全部展开
                      </button>
                    </div>
                    <CourseTree
                      tree={state.filteredTree.slice(0, state.visibleCourses)}
                      selectedLesson={state.currentLesson}
                      expanded={state.expanded}
                      searching={false}
                      sameCourseIds={state.sameCourseIds}
                      harvestInflight={state.harvestInflight}
                      courseMapBusy={state.courseMapBusy}
                      onRemoveCourse={state.removeCourse}
                      onCourseMap={state.openCourseMap}
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
            {TAB_LABELS.map((t, i) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                class={tab === t.id ? 'active' : ''}
                title={`Ctrl+${i + 1}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {tab === 'tasks' &&
            (
            <div role="tabpanel" id="panel-tasks" aria-labelledby="tab-tasks">
            {showWelcome ? (
              /* 批2（plan 2026-09-18 typography）: 零课程时主区承接三步引导。
                 此前主区空态写「先选择课时：从左侧课程树点击一个课时」，而左侧一门
                 课都没有（T2 两处空态自相矛盾），且引导被塞在 269px 侧栏里、主区
                 962px 空着（T3）。侧栏保留同一份内容的紧凑版。 */
              <section class="task-panel">
                <PageHeader title="任务" />
                <WelcomeGuide
                  variant="main"
                  onLogin={state.login}
                  onOpenBili={state.openBili}
                  onOpenSettings={() => setTab('settings')}
                  busy={state.sessionBusy}
                />
              </section>
            ) : (
              <TaskPanel
                currentLesson={state.currentLesson}
                lessonContext={state.lessonContextOrIndex}
                lessonOptions={state.currentCourseLessons}
                onSelectLesson={state.switchLesson}
                running={state.running}
                busy={state.submitBusy}
                progress={state.progress}
                history={state.history}
                globalHistory={state.globalHistory}
                globalHistoryTotal={state.globalHistoryTotal}
                onMoreHistory={state.showMoreTasks}
                onCreateRun={state.createAndRun}
                onRetry={state.retryTask}
                onCancel={state.cancelTask}
                onDelete={state.removeTask}
                onClearFinished={state.clearFinishedTasks}
                onOpenNote={state.openLessonNotes}
                onReportError={state.reportError}
              />
            )}
            </div>
          )}
          {tab === 'notes' && (
            <div role="tabpanel" id="panel-notes" aria-labelledby="tab-notes">
            <NoteViewer
              note={state.note}
              attachmentManifest={state.attachmentManifest}
              getAttachment={state.getAttachment}
              attachmentVersion={state.attachmentVersion}
              coverDataUrl={state.coverDataUrl}
              lesson={state.lessonContextOrIndex}
              lessonOptions={state.currentCourseLessons}
              currentLessonId={state.currentLesson}
              library={state.noteIndex}
              libraryTotal={state.noteIndexTotal}
              libraryQuery={state.noteQuery}
              onLibraryQuery={state.setNoteQuery}
              onLibraryMore={state.showMoreNotes}
              onOpenLesson={state.selectLesson}
              onUpgradeCourse={state.openNoteUpgrade}
              onExportCourseObsidian={state.exportCourseObsidian}
              onGoTasks={goTasks}
              onOpenSource={state.currentCourseSource === 'bilibili' ? state.openSourceAt : undefined}
prevLesson={state.lessonNeighbors.prev}
              nextLesson={state.lessonNeighbors.next}
              onNavigateLesson={state.openLessonNotes}
              regenBusy={state.noteRegenBusy}
              pdfBusy={state.pdfBusy}
              exportBusy={state.exportBusy}
              onRegenerate={state.currentLesson !== '' ? () => state.regenerateNote(state.currentLesson) : undefined}
              repairBusy={state.noteRepairBusy}
              onRepair={state.currentLesson !== '' ? () => state.repairNote(state.currentLesson) : undefined}
              onExportPdf={state.currentLesson !== '' && state.note != null ? () => state.exportNotePdf(state.currentLesson) : undefined}
              onExport={state.currentLesson !== '' ? () => state.exportNote(state.currentLesson) : undefined}
              onExportObsidian={state.currentLesson !== '' && state.note != null ? () => state.exportNoteObsidian(state.currentLesson) : undefined}
              onExportAnki={state.currentLesson !== '' && state.note != null ? () => state.exportNoteAnki(state.currentLesson) : undefined}
              onExportSvg={state.currentLesson !== '' && state.note != null ? () => state.exportNoteSvg(state.currentLesson) : undefined}
              onExportPng={
                state.currentLesson !== '' && state.note != null
                  ? () => state.exportNotePng(state.currentLesson, state.note as Note)
                  : undefined
              }
              onCopy={state.copyNote}
              polishBusy={state.notePolishBusy}
              onPolish={state.currentLesson !== '' ? (feedback) => state.polishNote(state.currentLesson, feedback) : undefined}
            />
            </div>
          )}
          {tab === 'qa' && (
            <div role="tabpanel" id="panel-qa" aria-labelledby="tab-qa">
            <QaPanel
              entries={state.qaEntries}
              busy={state.qaBusy}
              hasLesson={state.currentLesson !== ''}
              lessonContext={state.lessonContextOrIndex != null ? { ...state.lessonContextOrIndex, lessonId: state.currentLesson } : null}
              lessonOptions={state.currentCourseLessons}
              onSelectLesson={state.switchLesson}
              hasNote={state.note != null}
              onAsk={state.ask}
              recent={state.qaRecent}
              onOpenLesson={state.selectLesson}
            />
            </div>
          )}
          {tab === 'settings' && (
            <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
            <SettingsPanel
              settings={state.settings}
              session={state.session}
              sessionInfo={state.sessionInfo}
              sessionBusy={state.sessionBusy}
              loadError={state.configLoadError}
              onRetryLoad={state.retryConfigLoad}
              biliSession={state.biliSession}
              onBiliLogout={state.biliLogout}
              onLogin={state.login}
              onLogout={state.logout}
              providers={state.providers}
              providerBusy={state.providerBusy}
              onSaveProvider={state.saveProvider}
              onRemoveProvider={state.removeProvider}
              onTestProvider={state.testProvider}
              providerTestResult={state.providerTest}
              providerTestBusy={state.providerTestBusy}
              onSetCacheDir={state.setCacheDir}
              onChooseCacheDir={state.chooseCacheDir}
              chosenCacheDir={state.chosenCacheDir}
              onSetTheme={state.setTheme}
              onChooseLibrary={state.chooseLibrary}
              libraryBusy={state.libraryBusy}
              onExportLibraryBackup={state.exportLibraryBackup}
              backupBusy={state.libraryBackupBusy}
              libraryMigrated={state.libraryMigrated}
              migrationProgress={state.migrationProgress}
              onOpenPath={state.openPath}
              onOpenFeedback={state.openFeedbackForm}
            />
            </div>
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

interface AppState extends NotesDomain, TasksDomain {
  session: SessionState
  sessionInfo: { savedAt: string | null; expiresAt: number | null }
  sessionBusy: boolean
  /** 批1 双源并列: B站 session for the TopBar badge / dialog / settings row. */
  biliSession: 'logged_in' | 'logged_out' | null
  /** 批1: the B站 import dialog (login + resolve + import live in it). */
  biliDialogOpen: boolean
  openBili: () => void
  closeBili: () => void
  refreshBiliSession: () => void
  biliLogout: () => void
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
  qaEntries: QaEntry[]
  qaBusy: boolean
  providers: ProvidersListResult | null
  providerBusy: boolean
  settings: AppSettingsInfo | null
  /** 批4: per-domain load failure with a retry affordance on the settings page. */
  configLoadError: { providers: string | null; settings: string | null }
  retryConfigLoad: () => void
  /** 声明批4: 导出前的版权提醒——非 null 表示有待办导出等着用户确认。 */
  exportNotice: { remember: boolean } | null
  setExportNoticeRemember: (value: boolean) => void
  confirmExportNotice: () => void
  cancelExportNotice: () => void
  /** 声明批6: 打开某个失败任务的诊断弹层（取回已脱敏文本供复制）。 */
  reportError: (taskId: string) => void
  /** 声明批6: 诊断弹层状态（null = 未打开）。 */
  feedbackReport: { busy: boolean; text: string } | null
  copyReport: () => void
  closeReport: () => void
  /** 声明批6: 打开测试期反馈表（地址在 main 侧）。 */
  openFeedbackForm: () => void
  toasts: ToastItem[]
  dismissToast: (id: number) => void
  /** Toast emitter (BiliImport and other sidebar components push here). */
  toast: (message: string, kind?: ToastKind, action?: { actionLabel: string; onAction: () => void }) => void
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
  /** 批A: clear the lesson selection (breadcrumb course crumb) — stays put. */
  clearLesson: () => void
  /** 批A: back to the start view — no lesson picked, tasks tab. */
  goHome: () => void
  /** 批A: switch lesson in place (chip dropdown) — keeps the current tab. */
  switchLesson: (lessonId: string) => void
  /** 批A: sibling lessons of the selected lesson's course (chip dropdown). */
  currentCourseLessons: LessonChipLesson[]
  /** 批 D (plan 2026-09-19): 当前课时所属课程的来源——决定「跳原片」按钮渲不渲染。 */
  currentCourseSource: 'seu' | 'bilibili'
  /** 批 D (plan 2026-09-19): 在默认浏览器打开原片并定位到 at 秒（main 侧拼 URL）。 */
  openSourceAt: (at: number) => void
  addManual: (courseId: string, lessonId: string) => Promise<boolean>
  /** B站导入落地 (plan 2026-09-06 M5): refresh + queue tasks per P. */
  biliImported: (courseId: string, lessonIds: string[]) => void
  /** A2: one click from a finished task to its note. */
  openLessonNotes: (lessonId: string) => void
  ask: (question: string) => void
  saveProvider: (input: { id?: string; name: string; baseUrl: string; apiKey: string; capabilities: string[]; models: Record<string, string> }) => void
  removeProvider: (id: string) => void
  testProvider: (input: { baseUrl: string; apiKey: string; model: string }) => void
  providerTest: { ok: boolean; text: string } | null
  providerTestBusy: boolean
  setCacheDir: (dir: string) => void
  /** C10: open the folder picker; result lands in the panel via chosenCacheDir. */
  chooseCacheDir: () => void
  chosenCacheDir: string | null
  /** C6: remove an empty course from the sidebar. */
  removeCourse: (courseId: string) => void
  setTheme: (theme: 'auto' | 'light' | 'dark') => void
  /** C3: migration busy state + live progress for the settings page. */
  libraryBusy: boolean
  /** 批5: persistent «restart to apply» notice after a finished migration. */
  libraryMigrated: boolean
  migrationProgress: { copied: number; total: number } | null
  chooseLibrary: () => void
  /** 批6 (D4): 资料库备份导出（busy 三件套见 SettingsPanel）。 */
  libraryBackupBusy: boolean
  exportLibraryBackup: () => void
  openPath: (kind: 'library' | 'cache' | 'exports' | 'logs') => void
  /** 声明批2: record first-run consent (see useConfigDomain). */
  acceptDisclaimer: () => void
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

function useAppState(bridge: SeuSummaryBridge, goTasks: () => void, goNotes: () => void, goSettings: () => void, goTab: (tab: 'tasks' | 'notes' | 'qa' | 'settings') => void): AppState {
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
  const [qaRecent, setQaRecent] = useState<QaRecentInfo[]>([])
  /** 批C: courses whose catalog harvest is in flight (play-page navigation). */
  const [harvestInflight, setHarvestInflight] = useState<ReadonlySet<string>>(new Set())
  const [qaEntries, setQaEntries] = useState<QaEntry[]>([])
  const [qaBusy, setQaBusy] = useState(false)
  // G1 (review): toasts + the config/provider domain live in dedicated hooks.
  const { toasts, toast, dismiss: dismissToast } = useToasts()
  // 批1 双源并列: the B站 session mirrors the CAS one — one badge per source.
  const [biliSession, setBiliSession] = useState<'logged_in' | 'logged_out' | null>(null)
  const [biliDialogOpen, setBiliDialogOpen] = useState(false)
  const refreshBiliSession = useCallback((): void => {
    void (async () => {
      const res = await bridge.bilibili.session()
      if (res.ok) setBiliSession(res.value?.state ?? 'logged_out')
    })()
  }, [bridge])
  const openBili = useCallback((): void => {
    setBiliDialogOpen(true)
    refreshBiliSession()
  }, [refreshBiliSession])
  const closeBili = useCallback((): void => setBiliDialogOpen(false), [])
  const biliLogout = useCallback((): void => {
    void (async () => {
      const res = await bridge.bilibili.logout()
      if (!res.ok) {
        toast(res.error ?? '退出失败', 'error')
        return
      }
      setBiliSession('logged_out')
      toast('已退出B站登录', 'info')
    })()
  }, [bridge, toast])
  const config = useConfigDomain(bridge, toast)
  const lessonRef = useRef('')
  /** 批2: last seen «taskId:state:stage» — history rows refetch only when it changes. */
  const lastProgressKeyRef = useRef('')
  /** 批5: identity-stable indirection for callbacks used inside long-lived
   *  subscriptions (see the note at openLessonNotesRef). */
  const openLessonNotesRef = useRef<(lessonId: string) => void>(() => undefined)
  /** The mount-time session read runs once per real mount: the effect's
   *  unstable deps (refreshTree flips with refreshBusy) must not re-read and
   *  clobber a session state the user just set by logging in. */
  const sessionReadDone = useRef(false)

  const { providers, providerBusy, providerTest, providerTestBusy, settings, loadError, chosenCacheDir, libraryBusy, libraryMigrated, migrationProgress, refreshProviders, refreshSettings, saveProvider, removeProvider, testProvider, setCacheDir, chooseCacheDir, setTheme, chooseLibrary, libraryBackupBusy, exportLibraryBackup, openPath, acceptDisclaimer, optOutCopyrightNotice, openFeedbackForm } = config

  // Theme override (U3): auto follows the system via CSS; explicit light/dark
  // sets an html data attribute that wins over prefers-color-scheme.
  useEffect(() => {
    const root = document.documentElement
    if (settings == null || settings.theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = settings.theme
  }, [settings])

  /** 批4: the settings page's 重试 for a failed providers/settings load. */
  const retryConfigLoad = useCallback((): void => {
    void refreshProviders()
    void refreshSettings()
  }, [refreshProviders, refreshSettings])

  // 声明批4 (plan 2026-09-11, D3=B/D6=A): 导出前的版权提醒。spec §9 与 README
  // 早就承诺「导出时会有提示」，这里把它兑现。
  //
  // 语义：**除用户明确勾过「不再提示」，每次导出都先提示**——勾了才写库，没勾
  // 下次还会出现。提醒不阻塞导出：确认即继续，取消就是这次不导。
  const [pendingExport, setPendingExport] = useState<{ run: () => void } | null>(null)
  const [exportNoticeRemember, setExportNoticeRemember] = useState(false)

  const guardExport = useCallback(
    (run: () => void): void => {
      if (settings?.copyrightNoticeOptOut === true) {
        run()
        return
      }
      setExportNoticeRemember(false)
      setPendingExport({ run })
    },
    [settings]
  )

  const confirmExportNotice = useCallback((): void => {
    const run = pendingExport?.run
    if (exportNoticeRemember) optOutCopyrightNotice()
    setPendingExport(null)
    run?.()
  }, [pendingExport, exportNoticeRemember, optOutCopyrightNotice])

  const cancelExportNotice = useCallback((): void => {
    setPendingExport(null)
  }, [])

  // 批8 (plan 2026-09-19, D5): notes/tasks 两域从 useAppState 抽出——状态与回调搬进
  // 专用 hook，这里只做组合。lessonRef 是两域与 qa 共用的「慢响应不得覆盖当前课时」尺。
  const notes = useNotesDomain(bridge, toast, { lessonRef, guardExport, tree, currentLesson })
  const tasks = useTasksDomain(bridge, toast, { lessonRef, currentLesson, providers, goSettings })

  // 声明批6: «反馈这个错误» —— 取回**已脱敏**的诊断文本供用户复制。应用不上报任何
  // 数据：文本只进本地状态，再由用户点「复制诊断信息」进他自己的剪贴板。
  const [reportTaskId, setReportTaskId] = useState<string | null>(null)
  const [reportText, setReportText] = useState('')
  const [reportBusy, setReportBusy] = useState(false)

  const reportError = useCallback(
    (taskId: string): void => {
      setReportTaskId(taskId)
      setReportText('')
      setReportBusy(true)
      void (async () => {
        const res = await bridge.feedback.diagnostics(taskId)
        setReportBusy(false)
        if (!res.ok) {
          toast(res.error ?? '无法整理诊断信息', 'error')
          setReportTaskId(null)
          return
        }
        setReportText(res.value?.text ?? '')
      })()
    },
    [bridge, toast]
  )

  // 批 D (plan 2026-09-19): B 站原片时间戳跳转。URL 在 main 侧拼（红线：不接受渲染层 URL）；
  // SEU 源的课时不渲染按钮（honesty：不给必然失败的入口），真被调用也由 main 如实拒绝。
  const openSourceAt = useCallback(
    (at: number): void => {
      if (currentLesson === '') return
      void (async () => {
        const res = await bridge.lessons.openSource(currentLesson, at)
        if (!res.ok) toast(res.error ?? '打开原片失败', 'error')
      })()
    },
    [bridge, currentLesson, toast]
  )
  
const copyReport = useCallback((): void => {
    void navigator.clipboard
      .writeText(reportText)
      .then(() => toast('诊断信息已复制，粘贴到反馈表即可', 'success'))
      .catch(() => toast('复制失败', 'error'))
  }, [reportText, toast])

  const closeReport = useCallback((): void => {
    setReportTaskId(null)
    setReportText('')
  }, [])

  const applyLocalTree = useCallback(async (): Promise<void> => {
    const res = await bridge.school.courseTree()
    if (res.ok && res.value != null) {
      // A4: store lessons «第N节»-sorted so every consumer reads one order.
      setTree(orderTreeLessonsByNumber(res.value))
      setTreeLoaded(true)
    } else if (!res.ok) {
      // 健康巡查 2026-09-12 批7: a local read failure used to leave the
      // sidebar at «暂无课程» with no word (mergeToast dedupes repeats).
      toast(res.error ?? '本地课程树读取失败', 'error')
    }
  }, [bridge, toast])

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
          // A4 (plan 2026-09-13): same de-conflation as the sidebar meta line —
          // «全校约» claimed more than pageCount×pageSize can know.
          toast(`本次刷新 ${list.value.loaded} 门课程 · 平台列表约 ${list.value.platformTotal} 门`, 'success')
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
  // 健康巡查 2026-09-12 批7: the mount effect depended on refreshTree's
  // identity, which flips with refreshBusy — every 刷新课程 start/end re-ran
  // the whole mount block (progress resubscription + every loader). The
  // latest callback rides through the ref instead; the effect stays
  // mount-once.
  const refreshTreeRef = useRef(refreshTree)
  refreshTreeRef.current = refreshTree



  const loadQaHistory = useCallback(async (lessonId: string): Promise<void> => {
    // Recorded exchanges live in the library (desc); show them oldest first.
    const res = await bridge.qa.history(lessonId)
    if (res.ok && res.value != null && lessonRef.current === lessonId) {
      const rows = res.value as Array<{ question: string; answer: string; created_at: string }>
      setQaEntries(rows.map((r) => ({ question: r.question, answer: r.answer, createdAt: r.created_at })).reverse())
    }
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
      notes.clearLessonData()
      void notes.loadNote(lessonId)
      void notes.loadAttachments(lessonId)
      void tasks.loadHistory(lessonId)
      void loadQaHistory(lessonId)
      // C9: land on the tab that matches the lesson's state — a processed
      // lesson opens its note, an unprocessed one opens the task creation.
      const fromTree = tree.some((c) => c.lessons.some((l) => l.id === lessonId && l.hasNote))
      const fromIndex = notes.noteIndex.some((e) => e.lessonId === lessonId)
      goTab(fromTree || fromIndex ? 'notes' : 'tasks')
    },
    [notes.loadNote, notes.loadAttachments, tasks.loadHistory, loadQaHistory, tree, notes.noteIndex, goTab]
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
  // See the ref declaration above: assignments stay unconditional so the
  // subscription always calls the freshest closure without re-subscribing.
  openLessonNotesRef.current = openLessonNotes

  // 批A: drop the selection without leaving the current tab (breadcrumb's
  // course crumb); panels fall back to their library/empty states.
  // 2026-09-05: the note goes too — a stale note body under lesson=null read
  // as «the notes tab shows some other lesson's note» on the home view.
  const clearLesson = useCallback((): void => {
    setCurrentLesson('')
    lessonRef.current = ''
    setQaEntries([])
    notes.clearLessonData()
  }, [])

  // 批A: the brand click — back to the start view (no lesson, tasks tab).
  const goHome = useCallback((): void => {
    clearLesson()
    goTasks()
  }, [clearLesson, goTasks])

  // 批A: chip-dropdown switching — same loaders as selectLesson but the tab
  // stays put: the user is already on the page they chose to be on.
  const switchLesson = useCallback(
    (lessonId: string): void => {
      if (lessonId === '' || lessonId === lessonRef.current) return
      setCurrentLesson(lessonId)
      lessonRef.current = lessonId
      setQaEntries([])
      notes.clearLessonData()
      void notes.loadNote(lessonId)
      void notes.loadAttachments(lessonId)
      void tasks.loadHistory(lessonId)
      void loadQaHistory(lessonId)
    },
    [notes.loadNote, notes.loadAttachments, tasks.loadHistory, loadQaHistory]
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
        // C8: first-step guidance continues after the login round-trip.
        toast('登录成功', 'success', {
          actionLabel: '去选课',
          onAction: () => setAllCoursesOpen(true)
        })
        void refreshTreeRef.current()
        // M1-3 (B7): after a re-login, surface the retryable failures left
        // by the expired session instead of making the user hunt for them.
        const rows = await bridge.tasks.list()
        if (rows.ok && rows.value != null) {
          const retryable = rows.value.items.filter((t) => t.state === 'failed' && t.error_kind === 'session_expired')
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
    void refreshBiliSession()
    void notes.loadNoteIndex()
    void loadQaRecent()
    // 批C: resume the persisted lesson selection (loads note/attachments/
    // history/QA so tabs are coherent after a reload).
    const savedLesson = persisted.currentLesson ?? ''
    if (savedLesson !== '') {
      setCurrentLesson(savedLesson)
      lessonRef.current = savedLesson
      void notes.loadNote(savedLesson)
      void notes.loadAttachments(savedLesson)
      void tasks.loadHistory(savedLesson)
      void loadQaHistory(savedLesson)
    }
    // The renderer unloads during in-window navigations (harvest/未来登录) —
    // an in-flight task keeps running in main; restore its live state here.
    void (async () => {
      // 批4: 启动口径统一——任务列表只经 loadGlobalHistory 拉一次（分页 limit），
      // 不再叠加一次全表拉取把分页状态覆盖回全量。
      const items = await tasks.loadGlobalHistory()
      if (disposed) return
      const active = items.find((t) => isActiveState(t.state))
      if (active != null) {
        tasks.setRunning(true)
        tasks.setProgress({
          taskId: active.id,
          state: active.state,
          stage: active.failed_stage,
          message: '任务进行中（界面重载后恢复显示）',
          percent: RESTORE_PERCENT[active.state] ?? 5
        })
      }
    })()
    // 批2: 历史行实时刷新——state/stage 每次变化都重拉任务列表（本地 SQLite，
    // 开销可忽略；下载字节数等高频事件不触发）。修存量 bug：failed 后历史行
    // 仍显示旧的活动状态+可点「取消」，运行中行全程停留在旧状态。
    const off = bridge.tasks.onProgress((p) => {
      tasks.setProgress(p)
      const progressKey = `${p.taskId}:${p.state}:${p.stage ?? ''}`
      const keyChanged = lastProgressKeyRef.current !== progressKey
      if (keyChanged) lastProgressKeyRef.current = progressKey
      const lid = lessonRef.current
      if (p.state === 'succeeded') {
        // B1: other tasks may still be queued — recompute from the fresh rows.
        // 批4: 一次成功事件只拉一次任务列表——此前 key 变更路径与成功分支
        // 各发一次全量 tasks.list，且成功分支那份还是不带 limit 的全表。
        void (async () => {
          const rows = await tasks.loadGlobalHistory()
          tasks.setRunning(rows.some((t) => isActiveState(t.state)))
          const row = rows.find((t) => t.id === p.taskId)
          const doneLesson = row?.lesson_id ?? lid
          void notes.loadNoteIndex()
          if (doneLesson !== '') {
            void notes.loadNote(doneLesson)
            void tasks.loadHistory(doneLesson)
          }
          toast(`${row != null ? `「${taskLabelOf(row)}」任务完成` : `任务 ${p.taskId} 完成`}`, 'success', {
            actionLabel: '查看笔记',
            onAction: () => openLessonNotesRef.current(doneLesson !== '' ? doneLesson : lid)
          })
        })()
      } else {
        if (keyChanged) {
          void tasks.loadGlobalHistory()
          if (lid !== '') void tasks.loadHistory(lid)
        }
        if (p.state === 'failed') {
        void (async () => {
          const rows = await bridge.tasks.list()
          tasks.setRunning(rows.ok && rows.value != null ? rows.value.items.some((t) => isActiveState(t.state)) : false)
        })()
        toast(p.message, 'error')
        if (p.kind === 'session_expired') toast('会话已过期，登录后可重试此任务', 'error')
        }
      }
    })
    return () => {
      disposed = true
      off()
    }
    // openLessonNotes goes through its ref (identity-unstable: it flips with
    // tree/noteIndex, and this effect calls applyLocalTree which produces a
    // fresh tree — depending on it directly re-runs the effect forever).
    // refreshTree goes through its ref too (健康巡查 2026-09-12 批7: its
    // identity flips with refreshBusy).
  }, [bridge, toast, applyLocalTree, refreshProviders, refreshSettings, refreshBiliSession, notes.loadNote, notes.loadAttachments, tasks.loadHistory, loadQaHistory, tasks.loadGlobalHistory, notes.loadNoteIndex, loadQaRecent, goTasks])

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
    void (async () => {
      // Awaited: local state clears only after main actually wiped the
      // cookie jars (fire-and-forget raced the cleanup — review A8).
      await bridge.school.logout()
      setSession('logged_out')
      setTree([])
      setCurrentLesson('')
      notes.clearLessonData()
      tasks.clearLessonData()
      setQaEntries([])
      toast('已退出登录', 'info')
    })()
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
    const entry = notes.noteIndex.find((e) => e.lessonId === currentLesson)
    if (entry == null) return null
    return {
      courseName: entry.courseName ?? entry.lessonId,
      teacher: entry.teacher ?? undefined,
      lessonTitle: entry.lessonTitle ?? entry.lessonId
    }
  }, [lessonContext, notes.noteIndex, currentLesson])

  // 批A: the selected lesson's course (for the chip's sibling-lesson dropdown).
  const currentCourse = useMemo(() => {
    if (currentLesson === '') return null
    for (const c of tree) {
      if (c.lessons.some((l) => l.id === currentLesson)) return c
    }
    return null
  }, [tree, currentLesson])
  const currentCourseSource: 'seu' | 'bilibili' = currentCourse?.source ?? 'seu'
  
const currentCourseLessons = useMemo<LessonChipLesson[]>(
    () => (currentCourse?.lessons ?? []).map((l) => ({ id: l.id, title: l.title, hasNote: l.hasNote })),
    [currentCourse]
  )

  const filteredTree = useMemo<CourseTreeInfo[]>(() => {
    // 批4 (plan 2026-09-13, D7): one search predicate shared with the course
    // browser — the sidebar gains classroom/courTimes/subject-code matching.
    if (debouncedQuery.trim() === '') return orderedTree.tree
    const q = debouncedQuery.trim().toLowerCase()
    return orderedTree.tree
      .filter((c) => courseMatchesQuery(c, debouncedQuery))
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
  // window navigates away mid-call, so the outcome is reported by the fresh
  // mount's harvestState polling (批C). 健康巡查 2026-09-12: while THIS
  // session still renders, the course row needs its «正在抓取课时目录…» badge
  // (optimistic), and a validation rejection — which resolves as an err
  // envelope BEFORE any navigation — must surface here instead of dying
  // silently behind a 3.5s «请稍候» toast.
  const harvestLessons = useCallback(
    (courseId: string): void => {
      confirmPlatformJump('harvest', () => {
        if (harvestInflight.has(courseId)) return
        setHarvestInflight((prev) => new Set(prev).add(courseId))
        toast('正在打开播放页抓取课时目录，请稍候…')
        const clearInflight = (): void => {
          setHarvestInflight((prev) => {
            const next = new Set(prev)
            next.delete(courseId)
            return next
          })
        }
        void bridge.school
          .harvestLessons(courseId)
          .then(async (res) => {
            if (!res.ok) {
              clearInflight()
              toast(`抓取课时目录失败：${(res.error ?? '未知错误').slice(0, 120)}`, 'error')
              return
            }
            clearInflight()
            await applyLocalTree()
          })
          .catch(() => {
            clearInflight()
            toast('抓取课时目录失败：与主进程的连接中断', 'error')
          })
      })
    },
    [bridge, toast, applyLocalTree, confirmPlatformJump, harvestInflight]
  )

  // C2: pin/unpin «my course»; re-read the local tree so the ordering applies.
  // 批F: a favorite now confirms itself (the star is small; state must be heard).
  const toggleMine = useCallback(
    (courseId: string, mine: boolean): void => {
      void (async () => {
        const res = await bridge.school.setMine(courseId, mine)
        if (!res.ok) {
          toast(res.error ?? '操作失败', 'error')
          return
        }
        if (mine) {
          const course = tree.find((c) => c.id === courseId)
          toast(`已收藏「${course?.name ?? courseId}」`, 'success')
        }
        await applyLocalTree()
      })()
    },
    [bridge, toast, applyLocalTree, tree]
  )

  const addManual = useCallback(
    (courseId: string, lessonId: string): Promise<boolean> => {
      // 批5: returns success so the form clears only when the add landed —
      // a failure used to wipe the ids the user had to hunt down.
      return (async () => {
        const res = await bridge.school.addManualCourse(courseId, lessonId)
        if (!res.ok) {
          toast(res.error ?? '添加失败', 'error')
          return false
        }
        toast('已添加课程与课时', 'success')
        await refreshTree()
        selectLesson(lessonId)
        return true
      })()
    },
    [bridge, toast, refreshTree, selectLesson]
  )


  /** B站导入落地 (plan 2026-09-06 M5 · 续链改造 2026-09-07): create one
   *  pending task row per selected P, launch the first — the main process
   *  auto-starts the next pending row whenever one succeeds (the queue cap
   *  never blocks a multi-P import). */
  const biliImported = useCallback(
    (_courseId: string, lessonIds: string[]): void => {
      void (async () => {
        await refreshTree()
        const caps = new Set((providers?.bindings ?? []).map((b) => b.capability))
        if (!caps.has('multimodal')) {
          toast('尚未绑定多模态模型，笔记无法生成。请先在设置中配置 Provider。', 'error', {
            actionLabel: '去设置',
            onAction: goSettings
          })
          return
        }
        const taskIds: string[] = []
        for (const lessonId of lessonIds) {
          const created = await bridge.tasks.create(lessonId)
          if (!created.ok) {
            toast(created.error ?? '创建任务失败', 'error')
            continue
          }
          taskIds.push((created.value as { id: string }).id)
        }
        if (taskIds.length === 0) return
        await tasks.launch(taskIds[0]!, tasks.running)
        if (lessonIds[0] != null) selectLesson(lessonIds[0])
        goTasks()
        toast(`已导入 ${lessonIds.length} 个分P：完成一个自动开始下一个`, 'success')
      })()
    },
    [bridge, providers, tasks.running, tasks.launch, refreshTree, toast, goSettings, goTasks, selectLesson]
  )


  const ask = useCallback(
    (question: string): void => {
      const lid = lessonRef.current
      if (lid === '' || qaBusy) return
      // 批C: no-note soft guard — asking stays allowed (anti-gatekeeping),
      // but the answer's basis is stated up front instead of silently swapped.
      if (notes.note == null) toast('该课时尚无笔记，回答不基于笔记内容', 'info')
      // 批C: optimistic bubble — the user sees their question immediately.
      const stamp = new Date().toISOString()
      setQaEntries((es) => [...es, { question, answer: '', createdAt: stamp, pending: true }])
      void (async () => {
        setQaBusy(true)
        try {
          const res = await bridge.qa.ask(lid, question)
          // A lesson switch/clear while in flight must not leak the answer
          // into another lesson's conversation (same guard as the loaders).
          if (lessonRef.current !== lid) return
          const entry: QaEntry = res.ok
            ? { question, answer: (res.value as { answer: string }).answer, createdAt: stamp }
            : { question, answer: '', error: res.error ?? '未知错误', createdAt: stamp }
          setQaEntries((es) => {
            // 批4: a retry also replaces the failed bubble with the same question.
            const idx = es.findIndex((e) => (e.pending === true || e.error != null) && e.question === question)
            if (idx < 0) return [...es, entry]
            const next = [...es]
            next[idx] = entry
            return next
          })
          if (res.ok) void loadQaRecent()
        } finally {
          setQaBusy(false)
        }
      })()
    },
    [bridge, qaBusy, notes.note, toast, loadQaRecent]
  )


  /** C6: remove an empty (never-processed) course from the sidebar. */
  const removeCourse = useCallback(
    (courseId: string): void => {
      void (async () => {
        const res = await bridge.school.removeCourse(courseId)
        if (!res.ok) {
          toast(res.error ?? '删除失败', 'error')
          return
        }
        toast('已删除该课程', 'success')
        await applyLocalTree()
      })()
    },
    [bridge, toast, applyLocalTree]
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
    ...notes,
    ...tasks,
    session,
    sessionInfo,
    sessionBusy,
    biliSession,
    biliDialogOpen,
    openBili,
    closeBili,
    refreshBiliSession,
    biliLogout,
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
    qaRecent,
    harvestInflight,
    openLessonNotes,
    qaEntries,
    qaBusy,
    providers,
    providerBusy,
    settings,
    configLoadError: loadError,
    retryConfigLoad,
    exportNotice: pendingExport != null ? { remember: exportNoticeRemember } : null,
    setExportNoticeRemember,
    confirmExportNotice,
    cancelExportNotice,
    reportError,
    feedbackReport: reportTaskId != null ? { busy: reportBusy, text: reportText } : null,
    copyReport,
    closeReport,
    openFeedbackForm,
    toasts,
    dismissToast,
    toast,
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
    clearLesson,
    goHome,
    switchLesson,
    currentCourseLessons,
    currentCourseSource,
    openSourceAt,
    addManual,
    biliImported,
    ask,
    saveProvider,
    removeProvider,
    testProvider,
    providerTest,
    providerTestBusy,
    setCacheDir,
    chooseCacheDir,
    chosenCacheDir,
    removeCourse,
    setTheme,
    libraryBusy,
    libraryMigrated,
    migrationProgress,
    chooseLibrary,
    libraryBackupBusy,
    exportLibraryBackup,
    openPath,
    acceptDisclaimer
  }
}
