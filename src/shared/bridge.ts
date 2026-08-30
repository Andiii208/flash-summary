/**
 * Renderer-facing bridge type. Mirrors the preload api shape without
 * importing any Electron or main-process module (keeps the web tsconfig
 * free of node dependencies).
 */
import type { ApiResult } from './api-result'

export interface SchoolBridge {
  login(): Promise<ApiResult<{ state: string }>>
  logout(): Promise<ApiResult<{ state: string }>>
  session(): Promise<ApiResult<{ state: string }>>
  listCourses(): Promise<ApiResult<Array<{ id: string; name: string; term?: string; teacher?: string }>>>
}

export interface ProvidersBridge {
  list(): Promise<ApiResult<unknown>>
  save(input: { id?: string; name: string; baseUrl: string; apiKey: string }): Promise<ApiResult<{ id: string; hasKey: boolean }>>
  remove(id: string): Promise<ApiResult<boolean>>
  bind(capability: string, providerId: string, model: string): Promise<ApiResult<boolean>>
}

export interface TasksBridge {
  create(lessonId: string): Promise<ApiResult<{ id: string }>>
  get(taskId: string): Promise<ApiResult<unknown>>
  run(taskId: string): Promise<ApiResult<unknown>>
  retry(taskId: string): Promise<ApiResult<unknown>>
}

export interface NotesBridge {
  latest(lessonId: string): Promise<ApiResult<unknown>>
  versions(lessonId: string): Promise<ApiResult<unknown>>
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
}
