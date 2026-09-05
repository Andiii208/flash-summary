import { contextBridge, ipcRenderer } from 'electron'
import type { ApiResult } from '../shared/api-result'
import type {
  SeuSummaryBridge,
  CourseTreeInfo,
  ProvidersListResult,
  TaskRowInfo,
  TaskProgressInfo,
  AppSettingsInfo,
  NoteAttachmentInfo, AttachmentManifestEntry,
  NoteIndexInfo,
  QaRecentInfo
} from '../shared/bridge'
import type { SessionStateValue } from '../shared/types'

/**
 * Renderer bridge. Every call returns an ApiResult envelope; the renderer
 * never receives raw exceptions and the main process stays the only owner
 * of the database, the school session, and provider keys.
 */
const api: SeuSummaryBridge = {
  school: {
    login: (): Promise<ApiResult<{ state: string }>> => ipcRenderer.invoke('school:login'),
    logout: (): Promise<ApiResult<{ state: string }>> => ipcRenderer.invoke('school:logout'),
    session: (): Promise<
      ApiResult<{
        state: SessionStateValue
        justLoggedIn?: boolean
        loginOutcome?: { ok: boolean; message: string } | null
        savedAt?: string | null
        expiresAt?: number | null
      }>
    > => ipcRenderer.invoke('school:session'),
    listCourses: (): Promise<ApiResult<{ loaded: number; platformTotal: number; platformPages: number }>> =>
      ipcRenderer.invoke('school:listCourses'),
    onRefreshProgress: (cb: (p: { page: number; pageCount: number }) => void): (() => void) => {
      const listener = (_e: unknown, p: { page: number; pageCount: number }): void => cb(p)
      ipcRenderer.on('school:refreshProgress', listener)
      return () => ipcRenderer.removeListener('school:refreshProgress', listener)
    },
    addManualCourse: (courseId: string, lessonId: string): Promise<ApiResult<{ courseId: string; lessonId: string }>> =>
      ipcRenderer.invoke('school:addManualCourse', courseId, lessonId),
    courseTree: (): Promise<ApiResult<CourseTreeInfo[]>> => ipcRenderer.invoke('school:courseTree'),
    harvestLessons: (courseId: string): Promise<ApiResult<{ lessons: number }>> =>
      ipcRenderer.invoke('school:harvestLessons', courseId),
    harvestState: (): Promise<ApiResult<{ inflight: string[]; outcome: { seq: number; courseId: string; ok: boolean; lessons: number; error?: string } | null }>> =>
      ipcRenderer.invoke('school:harvestState'),
    removeCourse: (courseId: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('school:removeCourse', courseId),
    netCheck: (): Promise<ApiResult<{ intercepted: boolean; resolved: Array<{ host: string; ip: string }> }>> =>
      ipcRenderer.invoke('school:netCheck'),
    setMine: (courseId: string, mine: boolean): Promise<ApiResult<boolean>> =>
      ipcRenderer.invoke('school:setMine', courseId, mine)
  },
  providers: {
    list: (): Promise<ApiResult<ProvidersListResult>> => ipcRenderer.invoke('providers:list'),
    save: (input: { id?: string; name: string; baseUrl: string; apiKey: string }): Promise<ApiResult<{ id: string; hasKey: boolean }>> =>
      ipcRenderer.invoke('providers:save', input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('providers:delete', id),
    bind: (capability: string, providerId: string, model: string): Promise<ApiResult<boolean>> =>
      ipcRenderer.invoke('providers:bind', capability, providerId, model),
    test: (input: { baseUrl: string; apiKey: string; model: string }): Promise<ApiResult<{ latencyMs: number; answer: string }>> =>
      ipcRenderer.invoke('providers:test', input)
  },
  tasks: {
    create: (lessonId: string): Promise<ApiResult<{ id: string }>> => ipcRenderer.invoke('tasks:create', lessonId),
    list: (lessonId?: string): Promise<ApiResult<TaskRowInfo[]>> => ipcRenderer.invoke('tasks:list', lessonId),
    runAsync: (taskId: string): Promise<ApiResult<{ id: string; state: string }>> => ipcRenderer.invoke('tasks:runAsync', taskId),
    cancel: (taskId: string): Promise<ApiResult<{ cancelled: boolean }>> => ipcRenderer.invoke('tasks:cancel', taskId),
    remove: (taskId: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('tasks:delete', taskId),
    clearFinished: (): Promise<ApiResult<{ removed: number }>> => ipcRenderer.invoke('tasks:clearFinished'),
    onProgress: (cb: (p: TaskProgressInfo) => void): (() => void) => {
      const listener = (_e: unknown, p: TaskProgressInfo): void => cb(p)
      ipcRenderer.on('tasks:progress', listener)
      return () => ipcRenderer.removeListener('tasks:progress', listener)
    }
  },
  notes: {
    latest: (lessonId: string): Promise<ApiResult<unknown>> => ipcRenderer.invoke('notes:latest', lessonId),
    list: (): Promise<ApiResult<NoteIndexInfo[]>> => ipcRenderer.invoke('notes:list'),
    exportMarkdown: (lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string }>> =>
      ipcRenderer.invoke('notes:exportMarkdown', lessonId),
    exportAnki: (lessonId: string): Promise<ApiResult<{ canceled: boolean; paths: string[] }>> =>
      ipcRenderer.invoke('notes:exportAnki', lessonId),
    exportSvg: (lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string }>> =>
      ipcRenderer.invoke('notes:exportSvg', lessonId),
    attachments: (lessonId: string): Promise<ApiResult<AttachmentManifestEntry[]>> =>
      ipcRenderer.invoke('notes:attachments', lessonId),
    attachmentData: (lessonId: string, ref: string): Promise<ApiResult<NoteAttachmentInfo | null>> =>
      ipcRenderer.invoke('notes:attachmentData', lessonId, ref),
    regenerate: (lessonId: string): Promise<ApiResult<{ version: number; images: number; hitRate: { hits: number; total: number }; droppedRefs?: number }>> =>
      ipcRenderer.invoke('notes:regenerate', lessonId),
    exportPdfDialog: (lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string; token?: string }>> =>
      ipcRenderer.invoke('notes:exportPdfDialog', lessonId),
    exportPdfWrite: (token: string): Promise<ApiResult<{ path: string; bytes: number }>> =>
      ipcRenderer.invoke('notes:exportPdfWrite', token),
    revealFile: (path: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('notes:revealFile', path)
  },
  qa: {
    ask: (lessonId: string, question: string): Promise<ApiResult<{ id: string; answer: string }>> =>
      ipcRenderer.invoke('qa:ask', lessonId, question),
    history: (lessonId: string): Promise<ApiResult<Array<{ question: string; answer: string; created_at: string }>>> =>
      ipcRenderer.invoke('qa:history', lessonId),
    recent: (): Promise<ApiResult<QaRecentInfo[]>> => ipcRenderer.invoke('qa:recent')
  },
  settings: {
    get: (): Promise<ApiResult<AppSettingsInfo>> => ipcRenderer.invoke('settings:get'),
    setCacheDir: (dir: string): Promise<ApiResult<{ cacheDir: string }>> => ipcRenderer.invoke('settings:setCacheDir', dir),
    chooseCacheDir: (): Promise<ApiResult<{ canceled: boolean; path?: string }>> => ipcRenderer.invoke('settings:chooseCacheDir'),
    setTheme: (theme: 'auto' | 'light' | 'dark'): Promise<ApiResult<{ theme: string }>> => ipcRenderer.invoke('settings:setTheme', theme),
    chooseLibrary: (): Promise<ApiResult<{ canceled: boolean; libraryRoot?: string; restartRequired?: boolean }>> =>
      ipcRenderer.invoke('settings:chooseLibrary'),
    openPath: (kind: 'library' | 'cache' | 'exports' | 'logs'): Promise<ApiResult<boolean>> => ipcRenderer.invoke('settings:openPath', kind),
    onMigrateProgress: (cb: (p: { copied: number; total: number }) => void): (() => void) => {
      const listener = (_e: unknown, p: { copied: number; total: number }): void => cb(p)
      ipcRenderer.on('library:migrationProgress', listener)
      return () => ipcRenderer.removeListener('library:migrationProgress', listener)
    }
  },
  log: {
    rendererError: (message: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('log:rendererError', message)
  }
}

export type SeuSummaryApi = typeof api

contextBridge.exposeInMainWorld('seuSummary', api)
