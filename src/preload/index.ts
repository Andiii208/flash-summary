import { contextBridge, ipcRenderer } from 'electron'
import type { ApiResult } from '../shared/api-result'
import type { AppSettingsInfo, AttachmentManifestEntry, BilibiliResolveResult, CourseTreeInfo, LatestNoteResult, ListPage, ListPageQuery, NoteAttachmentInfo, NoteHealthInfo, NoteIndexInfo, PolishResult, ProvidersListResult, QaRecentInfo, RegenerateResult, RepairResult, SeuSummaryBridge, TaskProgressInfo, TaskRowInfo, UpdateCheckInfo, UpdateEvent } from '../shared/bridge'
import type { TreeNode } from '../shared/notes/schema'
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
  bilibili: {
    login: (): Promise<ApiResult<{ qrUrl: string }>> => ipcRenderer.invoke('bilibili:login'),
    loginStatus: (): Promise<ApiResult<{ status: 'inactive' | 'waiting' | 'scanned' | 'confirmed' | 'expired' }>> =>
      ipcRenderer.invoke('bilibili:loginStatus'),
    logout: (): Promise<ApiResult<{ state: 'logged_in' | 'logged_out' }>> => ipcRenderer.invoke('bilibili:logout'),
    session: (): Promise<ApiResult<{ state: 'logged_in' | 'logged_out'; savedAt?: string | null }>> =>
      ipcRenderer.invoke('bilibili:session'),
    resolve: (input: string): Promise<ApiResult<BilibiliResolveResult>> => ipcRenderer.invoke('bilibili:resolve', input),
    import: (payload: { bvid: string; pages: number[] }): Promise<ApiResult<{ courseId: string; lessonIds: string[] }>> =>
      ipcRenderer.invoke('bilibili:import', payload)
  },
  providers: {
    list: (): Promise<ApiResult<ProvidersListResult>> => ipcRenderer.invoke('providers:list'),
    save: (input: { id?: string; name: string; baseUrl: string; apiKey: string }): Promise<ApiResult<{ id: string; hasKey: boolean }>> =>
      ipcRenderer.invoke('providers:save', input),
    remove: (id: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('providers:delete', id),
    bind: (capability: string, providerId: string, model: string): Promise<ApiResult<boolean>> =>
      ipcRenderer.invoke('providers:bind', capability, providerId, model),
    // 批4 (plan 2026-09-20, P14): 解绑——声明必须与 bridge.ts 一致（整对象按
    // SeuSummaryBridge 标注，签名漂移就是 TS2322）。
    unbind: (capability: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('providers:unbind', capability),
    test: (input: { baseUrl: string; apiKey: string; model: string }): Promise<ApiResult<{ latencyMs: number; answer: string }>> =>
      ipcRenderer.invoke('providers:test', input)
  },
  tasks: {
    create: (lessonId: string): Promise<ApiResult<{ id: string }>> => ipcRenderer.invoke('tasks:create', lessonId),
    list: (lessonId?: string, page?: ListPageQuery): Promise<ApiResult<ListPage<TaskRowInfo>>> =>
      ipcRenderer.invoke('tasks:list', lessonId, page),
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
    // 批2 (plan 2026-09-20, P7): 声明必须与 bridge.ts 一致——ApiResult<T> 的 value
    // 是可变可选属性，unknown 不可赋给收窄后的联合（只改 bridge 不改这里就是 TS2322）。
    latest: (lessonId: string): Promise<ApiResult<LatestNoteResult | null>> => ipcRenderer.invoke('notes:latest', lessonId),
    list: (query?: ListPageQuery & { keyword?: string }): Promise<ApiResult<ListPage<NoteIndexInfo>>> =>
      ipcRenderer.invoke('notes:list', query),
    courseHealth: (courseId: string): Promise<ApiResult<NoteHealthInfo[]>> => ipcRenderer.invoke('notes:courseHealth', courseId),
    exportMarkdown: (lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string }>> =>
      ipcRenderer.invoke('notes:exportMarkdown', lessonId),
    exportObsidian: (lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string; version?: number }>> =>
      ipcRenderer.invoke('notes:exportObsidian', lessonId),
    exportCourseObsidian: (courseId: string): Promise<ApiResult<{ canceled: boolean; exported?: number; skipped?: number; failures?: Array<{ lessonId: string; reason: string }> }>> =>
      ipcRenderer.invoke('notes:exportCourseObsidian', courseId),
    exportAnki: (lessonId: string): Promise<ApiResult<{ canceled: boolean; paths: string[] }>> =>
      ipcRenderer.invoke('notes:exportAnki', lessonId),
    exportSvg: (lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string }>> =>
      ipcRenderer.invoke('notes:exportSvg', lessonId),
    exportPng: (lessonId: string, base64: string): Promise<ApiResult<{ canceled: boolean; path?: string }>> =>
      ipcRenderer.invoke('notes:exportPng', lessonId, base64),
    courseTree: (courseId: string): Promise<ApiResult<{ tree: TreeNode; lessons: number; skipped: number }>> =>
      ipcRenderer.invoke('notes:courseTree', courseId),
    attachments: (lessonId: string): Promise<ApiResult<AttachmentManifestEntry[]>> =>
      ipcRenderer.invoke('notes:attachments', lessonId),
    attachmentData: (lessonId: string, ref: string): Promise<ApiResult<NoteAttachmentInfo | null>> =>
      ipcRenderer.invoke('notes:attachmentData', lessonId, ref),
    cover: (lessonId: string): Promise<ApiResult<string | null>> => ipcRenderer.invoke('notes:cover', lessonId),
    // 批3 (plan 2026-09-20, P1): B 站封面回填（导入时抓失败/012 之前导入的课时）。
    backfillCover: (lessonId: string): Promise<ApiResult<{ coverPath: string }>> => ipcRenderer.invoke('notes:backfillCover', lessonId),
    // 批8 (audit 2026-09-28, H16): 返回类型用 bridge.ts 的命名 interface——此前是
    // 这里手抄的内联窄版（少 visionCapable/transcriptHitRate/normalizationDropped/
    // clampedTimes/transcriptSampled/health/refStats），字段漂移无声。
    regenerate: (lessonId: string): Promise<ApiResult<RegenerateResult>> => ipcRenderer.invoke('notes:regenerate', lessonId),
    polish: (lessonId: string, feedback: { tags: string[]; text: string }): Promise<ApiResult<PolishResult>> =>
      ipcRenderer.invoke('notes:polish', lessonId, feedback),
    // 批2 (plan 2026-09-20, P2): 定向补全。返回类型是命名 interface（批8 H16：
    // 此前是这里手抄的内联窄版，与真信封漂移无声）——ApiResult<T> 的 value 是
    // 可变可选属性，unknown 不可赋给收窄后的联合。
    repair: (lessonId: string): Promise<ApiResult<RepairResult>> => ipcRenderer.invoke('notes:repair', lessonId),
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
  // 批 D (plan 2026-09-19): 原片跳转——渲染层只传 lessonId 与秒数，URL 在 main 侧拼（红线）。
  lessons: {
    openSource: (lessonId: string, at: number): Promise<ApiResult<true>> => ipcRenderer.invoke('lessons:openSource', lessonId, at)
  },
  settings: {
    get: (): Promise<ApiResult<AppSettingsInfo>> => ipcRenderer.invoke('settings:get'),
    setCacheDir: (dir: string): Promise<ApiResult<{ cacheDir: string }>> => ipcRenderer.invoke('settings:setCacheDir', dir),
    chooseCacheDir: (): Promise<ApiResult<{ canceled: boolean; path?: string }>> => ipcRenderer.invoke('settings:chooseCacheDir'),
    setTheme: (theme: 'auto' | 'light' | 'dark'): Promise<ApiResult<{ theme: string }>> => ipcRenderer.invoke('settings:setTheme', theme),
    chooseLibrary: (): Promise<ApiResult<{ canceled: boolean; libraryRoot?: string; restartRequired?: boolean }>> =>
      ipcRenderer.invoke('settings:chooseLibrary'),
    openPath: (kind: 'library' | 'cache' | 'exports' | 'logs'): Promise<ApiResult<boolean>> => ipcRenderer.invoke('settings:openPath', kind),
    openAuthor: (): Promise<ApiResult<boolean>> => ipcRenderer.invoke('settings:openAuthor'),
    acceptDisclaimer: (): Promise<ApiResult<{ version: number }>> => ipcRenderer.invoke('settings:acceptDisclaimer'),
    optOutCopyrightNotice: (): Promise<ApiResult<{ version: number }>> => ipcRenderer.invoke('settings:optOutCopyrightNotice'),
    exportLibraryBackup: (): Promise<ApiResult<{ canceled: boolean; path?: string }>> =>
      ipcRenderer.invoke('settings:exportLibraryBackup'),
    onMigrateProgress: (cb: (p: { copied: number; total: number }) => void): (() => void) => {
      const listener = (_e: unknown, p: { copied: number; total: number }): void => cb(p)
      ipcRenderer.on('library:migrationProgress', listener)
      return () => ipcRenderer.removeListener('library:migrationProgress', listener)
    }
  },
  log: {
    rendererError: (message: string): Promise<ApiResult<boolean>> => ipcRenderer.invoke('log:rendererError', message)
  },
  // 声明批6: 只给入口、不上报——开反馈表（无参，地址在 main 侧）与取脱敏诊断文本。
  feedback: {
    openForm: (): Promise<ApiResult<boolean>> => ipcRenderer.invoke('feedback:openForm'),
    diagnostics: (taskId: string): Promise<ApiResult<{ text: string }>> => ipcRenderer.invoke('feedback:diagnostics', taskId)
  },
  // 2026-09-30 (plan 2026-09-30-public-release-autoupdate): 手动更新检查——
  // 三个 invoke 都不接 URL：更新源钉死在 main 侧 UPDATE_FEED 常量。
  update: {
    check: (): Promise<ApiResult<UpdateCheckInfo>> => ipcRenderer.invoke('update:check'),
    download: (): Promise<ApiResult<{ started: boolean }>> => ipcRenderer.invoke('update:download'),
    install: (): Promise<ApiResult<{ installed: boolean }>> => ipcRenderer.invoke('update:install'),
    onEvent: (cb: (e: UpdateEvent) => void): (() => void) => {
      const listener = (_e: unknown, event: UpdateEvent): void => cb(event)
      ipcRenderer.on('update:event', listener)
      return () => ipcRenderer.removeListener('update:event', listener)
    }
  }
}

export type SeuSummaryApi = typeof api

contextBridge.exposeInMainWorld('seuSummary', api)
