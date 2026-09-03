/**
 * Renderer-facing bridge type. Mirrors the preload api shape without
 * importing any Electron or main-process module (keeps the web tsconfig
 * free of node dependencies).
 */
import type { ApiResult } from './api-result'
import type { SessionStateValue } from './types'

export interface CourseSummaryInfo {
  id: string
  name: string
  term?: string
  teacher?: string
  /** Recording-class identifiers (main-side only; used for play-page routes). */
  teclId?: string
  teclCode?: string
}

export interface LessonTreeInfo {
  id: string
  title: string
  hasNote: boolean
}

export interface CourseTreeInfo extends CourseSummaryInfo {
  lessons: LessonTreeInfo[]
}

export interface TaskProgressInfo {
  taskId: string
  state: string
  stage: string | null
  message: string
  percent: number
  /** Set when the failure is a school session expiry (UI offers re-login). */
  kind?: 'session_expired'
}

export interface TaskRowInfo {
  id: string
  lesson_id: string
  state: string
  failed_stage: string | null
  error_message: string | null
  error_kind?: string | null
  created_at?: string
  updated_at?: string
}

export interface SchoolBridge {
  login(): Promise<ApiResult<{ state: string }>>
  logout(): Promise<ApiResult<{ state: string }>>
  /** justLoggedIn: one-shot — true on the first read after a login flow completed.
   *  loginOutcome: one-shot result of the last embedded login (the initiating
   *  renderer died mid-call, so the fresh mount reports success/failure).
   *  savedAt/expiresAt: local session metadata (JWT exp, no network). */
  session(): Promise<ApiResult<{
    state: SessionStateValue
    justLoggedIn?: boolean
    loginOutcome?: { ok: boolean; message: string } | null
    savedAt?: string | null
    expiresAt?: number | null
  }>>
  listCourses(): Promise<ApiResult<CourseSummaryInfo[]>>
  addManualCourse(courseId: string, lessonId: string): Promise<ApiResult<{ courseId: string; lessonId: string }>>
  courseTree(): Promise<ApiResult<CourseTreeInfo[]>>
  /** V1.3: harvest the course's lesson catalog from the play page (main window navigates away and back). */
  harvestLessons(courseId: string): Promise<ApiResult<{ lessons: number }>>
  /** Fake-IP preflight (A5): true when a proxy resolver answers the campus hosts with virtual addresses. */
  netCheck(): Promise<ApiResult<{ intercepted: boolean; resolved: Array<{ host: string; ip: string }> }>>
}

export interface ProviderListInfo {
  id: string
  name: string
  baseUrl: string
  hasKey: boolean
}

export interface ProviderBindingInfo {
  capability: string
  providerId: string
  model: string
}

export interface ProvidersListResult {
  providers: ProviderListInfo[]
  bindings: ProviderBindingInfo[]
}

export interface ProvidersBridge {
  /** Shape only — the plaintext apiKey never leaves the main process. */
  list(): Promise<ApiResult<ProvidersListResult>>
  save(input: { id?: string; name: string; baseUrl: string; apiKey: string }): Promise<ApiResult<{ id: string; hasKey: boolean }>>
  remove(id: string): Promise<ApiResult<boolean>>
  bind(capability: string, providerId: string, model: string): Promise<ApiResult<boolean>>
}

export interface TasksBridge {
  create(lessonId: string): Promise<ApiResult<{ id: string }>>
  list(lessonId?: string): Promise<ApiResult<TaskRowInfo[]>>
  /** Blocking run (kept for tests/tools); prefer runAsync in the UI. */
  run(taskId: string): Promise<ApiResult<unknown>>
  /** Fire-and-return execution (serialized in main, U4); progress via onProgress.
   *  A failed task re-run through this resumes from its failed stage. */
  runAsync(taskId: string): Promise<ApiResult<{ id: string; state: string }>>
  cancel(taskId: string): Promise<ApiResult<{ cancelled: boolean }>>
  onProgress(cb: (p: TaskProgressInfo) => void): () => void
}

export interface NotesBridge {
  latest(lessonId: string): Promise<ApiResult<unknown>>
  exportMarkdown(lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string }>>
}

export interface AppSettingsInfo {
  libraryRoot: string
  cacheDir: string
  theme: string
}

export interface SettingsBridge {
  get(): Promise<ApiResult<AppSettingsInfo>>
  setCacheDir(dir: string): Promise<ApiResult<{ cacheDir: string }>>
  setTheme(theme: 'auto' | 'light' | 'dark'): Promise<ApiResult<{ theme: string }>>
  chooseLibrary(): Promise<ApiResult<{ canceled: boolean; libraryRoot?: string; restartRequired?: boolean }>>
  openPath(kind: 'library' | 'cache' | 'exports' | 'logs'): Promise<ApiResult<boolean>>
}

export interface LogBridge {
  /** Forward a renderer-side error into the main file log (redacted). */
  rendererError(message: string): Promise<ApiResult<boolean>>
}

export interface QaBridge {
  ask(lessonId: string, question: string): Promise<ApiResult<{ id: string; answer: string }>>
  history(lessonId: string): Promise<ApiResult<Array<{ question: string; answer: string; created_at: string }>>>
}

export interface SeuSummaryBridge {
  school: SchoolBridge
  providers: ProvidersBridge
  tasks: TasksBridge
  notes: NotesBridge
  qa: QaBridge
  settings: SettingsBridge
  log: LogBridge
}
