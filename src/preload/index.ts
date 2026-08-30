import { contextBridge, ipcRenderer } from 'electron'
import type { ApiResult } from '../shared/api-result'
import type { SeuSummaryBridge } from '../shared/bridge'

/**
 * Renderer bridge. Every call returns an ApiResult envelope; the renderer
 * never receives raw exceptions and the main process stays the only owner
 * of the database, the school session, and provider keys.
 */
const api: SeuSummaryBridge = {
  school: {
    login: (): Promise<ApiResult<{ state: string }>> => ipcRenderer.invoke('school:login'),
    logout: (): Promise<ApiResult<{ state: string }>> => ipcRenderer.invoke('school:logout'),
    session: (): Promise<ApiResult<{ state: string }>> => ipcRenderer.invoke('school:session'),
    listCourses: (): Promise<ApiResult<Array<{ id: string; name: string; term?: string; teacher?: string }>>> =>
      ipcRenderer.invoke('school:listCourses')
  },
  providers: {
    list: (): Promise<ApiResult<unknown>> => ipcRenderer.invoke('providers:list'),
    save: (input: { id?: string; name: string; baseUrl: string; apiKey: string }): Promise<ApiResult<{ id: string; hasKey: boolean }>> =>
      ipcRenderer.invoke('providers:save', input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('providers:delete', id),
    bind: (capability: string, providerId: string, model: string): Promise<ApiResult<boolean>> =>
      ipcRenderer.invoke('providers:bind', capability, providerId, model)
  },
  tasks: {
    create: (lessonId: string): Promise<ApiResult<{ id: string }>> => ipcRenderer.invoke('tasks:create', lessonId),
    get: (taskId: string): Promise<ApiResult<unknown>> => ipcRenderer.invoke('tasks:get', taskId),
    run: (taskId: string): Promise<ApiResult<unknown>> => ipcRenderer.invoke('tasks:run', taskId),
    retry: (taskId: string): Promise<ApiResult<unknown>> => ipcRenderer.invoke('tasks:retry', taskId)
  },
  notes: {
    latest: (lessonId: string): Promise<ApiResult<unknown>> => ipcRenderer.invoke('notes:latest', lessonId),
    versions: (lessonId: string): Promise<ApiResult<unknown>> => ipcRenderer.invoke('notes:versions', lessonId)
  },
  qa: {
    ask: (lessonId: string, question: string): Promise<ApiResult<{ id: string; answer: string }>> =>
      ipcRenderer.invoke('qa:ask', lessonId, question),
    history: (lessonId: string): Promise<ApiResult<Array<{ question: string; answer: string; created_at: string }>>> =>
      ipcRenderer.invoke('qa:history', lessonId)
  }
}

export type SeuSummaryApi = typeof api

contextBridge.exposeInMainWorld('seuSummary', api)
