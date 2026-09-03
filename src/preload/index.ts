import { contextBridge, ipcRenderer } from 'electron'
import type { ApiResult } from '../shared/api-result'
import type {
  SeuSummaryBridge,
  CourseTreeInfo,
  ProvidersListResult,
  TaskRowInfo,
  TaskProgressInfo,
  AppSettingsInfo
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
    run: (taskId: string): Promise<ApiResult<unknown>> => ipcRenderer.invoke('tasks:run', taskId),
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
    exportMarkdown: (lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string }>> =>
      ipcRenderer.invoke('notes:exportMarkdown', lessonId)
  },
  qa: {
    ask: (lessonId: string, question: string): Promise<ApiResult<{ id: string; answer: string }>> =>
      ipcRenderer.invoke('qa:ask', lessonId, question),
    history: (lessonId: string): Promise<ApiResult<Array<{ question: string; answer: string; created_at: string }>>> =>
      ipcRenderer.invoke('qa:history', lessonId)
  },
  settings: {
    get: (): Promise<ApiResult<AppSettingsInfo>> => ipcRenderer.invoke('settings:get'),
    setCacheDir: (dir: string): Promise<ApiResult<{ cacheDir: string }>> => ipcRenderer.invoke('settings:setCacheDir', dir),
    setTheme: (theme: 'auto' | 'light' | 'dark'): Promise<ApiResult<{ theme: string }>> => ipcRenderer.invoke('settings:setTheme', theme),
    chooseLibrary: (): Promise<ApiResult<{ canceled: boolean; libraryRoot?: string; restartRequired?: boolean }>> =>
      ipcRenderer.invoke('settings:chooseLibrary'),
    openPath: (kind: 'library' | 'cache' | 'exports' | 'logs'): Promise<ApiResult<boolean>> => ipcRenderer.invoke('settings:openPath', kind)
  },
  log: {
    rendererError: (message: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('log:rendererError', message)
  }
}

export type SeuSummaryApi = typeof api

contextBridge.exposeInMainWorld('seuSummary', api)
