/**
 * Renderer-facing bridge type. Mirrors the preload api shape without
 * importing any Electron or main-process module (keeps the web tsconfig
 * free of node dependencies).
 */
import type { ApiResult } from './api-result'
import type { SessionStateValue } from './types'
import type { TreeNode } from './notes/schema'

export interface CourseSummaryInfo {
  id: string
  name: string
  term?: string
  teacher?: string
  /** Recording-class identifiers (main-side only; used for play-page routes). */
  teclId?: string
  teclCode?: string
  /** Subject code — shared across a subject's sections/teachers (C1). */
  subjCode?: string
  /** Video source: the school platform (default) or Bilibili (migration 009). */
  source?: 'seu' | 'bilibili'
  /** Classroom + meeting times as the platform shows them (C3). */
  classroom?: string
  courTimes?: string
}

export interface LessonTreeInfo {
  id: string
  title: string
  hasNote: boolean
}

export interface CourseTreeInfo extends CourseSummaryInfo {
  lessons: LessonTreeInfo[]
  /** Pinned as «my course» (C2); the sidebar sorts these first. */
  isMine?: boolean
  /** M1-4: extracted-study aggregation — the sidebar floats these. */
  noteCount?: number
  lastTaskAt?: string
  hasExtracted?: boolean
}

export interface TaskProgressInfo {
  taskId: string
  state: string
  stage: string | null
  message: string
  percent: number
  /** Set when the failure is a school session expiry (UI offers re-login). */
  kind?: 'session_expired'
  /** M1-3: sub-progress text (e.g. «已下载 412.3 MB · 2.1 MB/s»). */
  detail?: string
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
  /** M1-2: human-readable names from the lessons/courses JOIN. */
  lesson_title?: string | null
  course_name?: string | null
  /** F4: the course's teacher/meeting-times/classroom for the history rows. */
  teacher?: string | null
  courTimes?: string | null
  classroom?: string | null
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
  /** Paged refresh (B1): returns the loaded/total boundary the platform reports. */
  listCourses(): Promise<ApiResult<{ loaded: number; platformTotal: number; platformPages: number }>>
  addManualCourse(courseId: string, lessonId: string): Promise<ApiResult<{ courseId: string; lessonId: string }>>
  courseTree(): Promise<ApiResult<CourseTreeInfo[]>>
  /** V1.3: harvest the course's lesson catalog from the play page (main window navigates away and back). */
  harvestLessons(courseId: string): Promise<ApiResult<{ lessons: number }>>
  /** 批C: in-flight catalog harvests + last outcome, for the fresh mount after navigation. */
  harvestState(): Promise<ApiResult<{ inflight: string[]; outcome: { seq: number; courseId: string; ok: boolean; lessons: number; error?: string } | null }>>
  /** C6: remove an empty (never-processed) course; refuses otherwise. */
  removeCourse(courseId: string): Promise<ApiResult<boolean>>
  /** Fake-IP preflight (A5): true when a proxy resolver answers the campus hosts with virtual addresses. */
  netCheck(): Promise<ApiResult<{ intercepted: boolean; resolved: Array<{ host: string; ip: string }> }>>
  /** C2: pin/unpin a course as «mine» (sidebar sorts it first). */
  setMine(courseId: string, mine: boolean): Promise<ApiResult<boolean>>
  /** Page progress while a paged course refresh runs (B2). */
  onRefreshProgress(cb: (p: { page: number; pageCount: number }) => void): () => void
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
  /** M3 批 D: probe a form-configured provider without storing anything. */
  test(input: { baseUrl: string; apiKey: string; model: string }): Promise<ApiResult<{ latencyMs: number; answer: string }>>
}

export interface TasksBridge {
  create(lessonId: string): Promise<ApiResult<{ id: string }>>
  /** 批C: 分页列表（见 ListPage）——lessonId 为空时是全局列表。 */
  list(lessonId?: string, page?: ListPageQuery): Promise<ApiResult<ListPage<TaskRowInfo>>>
  /** Fire-and-return execution (serialized in main, U4); progress via onProgress.
   *  A failed task re-run through this resumes from its failed stage. */
  runAsync(taskId: string): Promise<ApiResult<{ id: string; state: string }>>
  cancel(taskId: string): Promise<ApiResult<{ cancelled: boolean }>>
  /** M1-2: delete one terminal task row (evidence + cache dir included). */
  remove(taskId: string): Promise<ApiResult<boolean>>
  /** M1-2: delete every terminal task row; returns how many. */
  clearFinished(): Promise<ApiResult<{ removed: number }>>
  onProgress(cb: (p: TaskProgressInfo) => void): () => void
}

/** 2026-09-04: one keyframe/PPT image for note views (data URL, CSP-safe). */
export interface NoteAttachmentInfo {
  /** Evidence id: `ppt:<page>` or `kf:<id>`. */
  ref: string
  kind: 'ppt' | 'keyframe'
  /** Seconds from lesson start; null for PPT pages (platform gives no timing). */
  at: number | null
  dataUrl: string
}

/** F4: identity-only attachment manifest entry. */
import type { AttachmentManifestEntry } from './notes/evidence'
export type { AttachmentManifestEntry }

/** 批B: one cross-lesson note library entry (notes:list, newest first). */
export interface NoteIndexInfo {
  lessonId: string
  version: number
  createdAt: string
  /** 质量批4: 升级入口按课程分组定位（group label 是展示串不可作键）。 */
  courseId: string | null
  courseName: string | null
  teacher: string | null
  lessonTitle: string | null
}

/** 批C (plan 2026-09-18 note-library-reachability): 分页请求参数。 */
export interface ListPageQuery {
  limit?: number
  offset?: number
}

/**
 * 批C: 列表页结构。此前 notes:list / tasks:list 返回**纯数组**——渲染层无法知道
 * 自己拿到的是不是全量，于是界面只好把「最近 200 条 / 最近 50 条」硬编码在文案里
 * （上限改了文案不会跟着改），而**被截断时从不告诉用户**：既不知道有更早的记录，
 * 也不知道去哪找。带上 total 之后 UI 才能如实说话。
 */
export interface ListPage<T> {
  items: T[]
  /** 满足条件的总数（不受 limit 影响）。 */
  total: number
  /** 本次请求的上限。 */
  limit: number
}

/** 质量批4 (plan 2026-09-08 note-quality-overhaul): one lesson's health row. */
export interface NoteHealthInfo {
  lessonId: string
  lessonTitle: string
  version: number
  /** warn 级发现数；note_json 损坏时以 3（weak 下限）上报。 */
  warnCount: number
  grade: 'good' | 'fair' | 'weak'
  /**
   * 批3 (2026-09-17): 产出该笔记的工艺版本（0 = 本列启用之前的存量笔记）。
   * 升级入口据此把「旧 prompt 但侥幸没 warn」的笔记也纳入建议范围。
   */
  promptVersion?: number
}

/** 批B: one recent Q&A exchange across lessons (qa:recent, newest first). */
export interface QaRecentInfo {
  lessonId: string
  question: string
  answer: string
  createdAt: string
  courseName: string | null
  lessonTitle: string | null
}

export interface NotesBridge {
  latest(lessonId: string): Promise<ApiResult<unknown>>
  /** 批B: every generated note across lessons (library list, newest first).
   *  批C: 分页 + 关键词（只匹配列表可见字段，见 main 侧注释）。 */
  list(query?: ListPageQuery & { keyword?: string }): Promise<ApiResult<ListPage<NoteIndexInfo>>>
  /** 质量批4: per-lesson health of a course's latest notes (升级旧笔记 picker). */
  courseHealth(courseId: string): Promise<ApiResult<NoteHealthInfo[]>>
  exportMarkdown(lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string }>>
  /** Obsidian 批1: structured markdown into the user's vault (+ attachments). */
  exportObsidian(lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string; version?: number }>>
  /** Obsidian 批2: whole-course export + derived pages (_概念/_index). */
  exportCourseObsidian(courseId: string): Promise<ApiResult<{ canceled: boolean; exported?: number; skipped?: number }>>
  /** 2026-09-04 roadmap 2.2: Anki TSV decks (concepts + quiz), one file per deck. */
  exportAnki(lessonId: string): Promise<ApiResult<{ canceled: boolean; paths: string[] }>>
  /** M3.3 (map expansion): the knowledge tree as a standalone paper-white SVG. */
  exportSvg(lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string }>>
  /** 批5 (2026-09-17): 位图导出——光栅化在渲染层（canvas），main 只管写字节。 */
  exportPng(lessonId: string, base64: string): Promise<ApiResult<{ canceled: boolean; path?: string }>>
  /** M4.1 (map expansion): course-level map aggregated from every lesson's latest tree. */
  courseTree(courseId: string): Promise<ApiResult<{ tree: TreeNode; lessons: number; skipped: number }>>
  /** 2026-09-04: keyframe/PPT attachments for note views. */
    /** F4 (review): identity manifest — data arrives per ref via attachmentData. */
  attachments(lessonId: string): Promise<ApiResult<AttachmentManifestEntry[]>>
  attachmentData(lessonId: string, ref: string): Promise<ApiResult<NoteAttachmentInfo | null>>
  /** 批 A2 (2026-09-19): 课时封面（B 站导入落盘）；无封面返回 ok(null)。 */
  cover(lessonId: string): Promise<ApiResult<string | null>>
  /** 2026-09-04: regenerate the note from stored transcripts/keyframes (no re-download). */
  regenerate(
    lessonId: string
  ): Promise<
    ApiResult<{
      version: number
      images: number
      hitRate: { hits: number; total: number }
      /** A1 (2026-09-19): false = 绑定模型无视觉能力，本次未发图（画面靠时间就近对齐）。 */
      visionCapable?: boolean
      /** A3 (2026-09-19): 本课时真实画面素材数（keyframes=0 = 断供）。 */
      visualAssets?: { keyframes: number; ppt: number }
      /** 批1 (2026-09-17): 转写摘引可核验率；null/缺省 = 没有可判的摘引。 */
      transcriptHitRate?: { hits: number; total: number } | null
      droppedRefs?: number
      /** 批3 (2026-09-17): 归一层各字段的丢弃计数（空对象 = 一项没丢）。 */
      normalizationDropped?: Record<string, number>
      /** B4 (plan 2026-09-19): at 超出转写范围被钳到上界的时间字段数（0 = 没外推）。 */
      clampedTimes?: number
      /** 批3: 生成闭环结果（返修后体检 + 是否真返修过 + 返修前的 warn 数）。 */
      health?: { warnCount: number; grade: 'good' | 'fair' | 'weak'; repaired: boolean; warnCountBeforeRepair: number | null }
    }>
  >
  /** 批5 (plan 2026-09-07 v07): feedback-driven polish — revises the latest note into version N+1. */
  polish(
    lessonId: string,
    feedback: { tags: string[]; text: string }
  ): Promise<
    ApiResult<{
      version: number
      hitRate: { hits: number; total: number }
      /** 批1 (2026-09-17): 转写摘引可核验率；null/缺省 = 没有可判的摘引。 */
      transcriptHitRate?: { hits: number; total: number } | null
      droppedRefs?: number
    }>
  >
  /** 2026-09-04: PDF handout step 1 — system save dialog for the target file. */
  exportPdfDialog(lessonId: string): Promise<ApiResult<{ canceled: boolean; path?: string; token?: string }>>
  /** 2026-09-04: PDF handout step 2 — print the main window (handout already
   *  rendered into #print-root) and write the file; returns the path + size. */
  /** E3 (review): the one-shot token from exportPdfDialog — never a raw path. */
  exportPdfWrite(token: string): Promise<ApiResult<{ path: string; bytes: number }>>
  /** 2026-09-04: reveal an exported file in Explorer. */
  revealFile(path: string): Promise<ApiResult<boolean>>
}

export interface AppSettingsInfo {
  libraryRoot: string
  cacheDir: string
  theme: string
  /** C7: app version for the settings footer. */
  version?: string
  /** 声明批2: the 使用须知 text version this build ships. */
  disclaimerVersion?: number
  /** 声明批2: true only when the stored acceptance matches disclaimerVersion. */
  disclaimerAccepted?: boolean
  /** 声明批4: the export copyright notice text version this build ships. */
  copyrightNoticeVersion?: number
  /** 声明批4: true when the user ticked «不再提示» for this text version. */
  copyrightNoticeOptOut?: boolean
}

export interface SettingsBridge {
  get(): Promise<ApiResult<AppSettingsInfo>>
  setCacheDir(dir: string): Promise<ApiResult<{ cacheDir: string }>>
  /** C10: folder picker for the cache dir (returns the chosen path, unsaved). */
  chooseCacheDir(): Promise<ApiResult<{ canceled: boolean; path?: string }>>
  setTheme(theme: 'auto' | 'light' | 'dark'): Promise<ApiResult<{ theme: string }>>
  chooseLibrary(): Promise<ApiResult<{ canceled: boolean; libraryRoot?: string; restartRequired?: boolean }>>
  /** 批6 (D4): 资料库备份导出——db.backup 到用户自选路径（与迁移「无 .bak 快照、
   * 靠源库兜底」的口径分开的独立入口）。只含数据库文件；取消/失败不留半成品。 */
  exportLibraryBackup(): Promise<ApiResult<{ canceled: boolean; path?: string }>>
  openPath(kind: 'library' | 'cache' | 'exports' | 'logs'): Promise<ApiResult<boolean>>
  /** 声明批2: record first-run consent for the current text version.
   *  Takes no argument on purpose — the version is main's own constant, so the
   *  renderer cannot vouch for text it never showed. */
  acceptDisclaimer(): Promise<ApiResult<{ version: number }>>
  /** 声明批4: record «不再提示» for the export copyright notice. No argument —
   *  same reasoning as acceptDisclaimer (the version is main's own constant). */
  optOutCopyrightNotice(): Promise<ApiResult<{ version: number }>>
  /** C3: live migration progress (copied/total attachment entries). */
  onMigrateProgress(cb: (p: { copied: number; total: number }) => void): () => void
}

export interface LogBridge {
  /** Forward a renderer-side error into the main file log (redacted). */
  rendererError(message: string): Promise<ApiResult<boolean>>
}

/**
 * 声明批6: 测试期问题反馈通道。
 *
 * **只给入口、不上报**——应用不向开发者发送任何数据。这里两个方法都不涉及网络
 * 上报：一个是用系统浏览器打开反馈表，一个是把已脱敏的诊断文本取回本地供用户
 * 复制。没有埋点、没有自动提交。
 */
export interface FeedbackBridge {
  /** 在系统浏览器打开反馈表。**不接参数**：地址只存在于 main 侧，渲染层无法让
   *  main 打开任意 URL（沿用 settings:openPath 的无参/枚举先例）。 */
  openForm(): Promise<ApiResult<boolean>>
  /** 某个失败任务的诊断文本（已过 main 的 redact），进用户自己的剪贴板。 */
  diagnostics(taskId: string): Promise<ApiResult<{ text: string }>>
}

export interface QaBridge {
  ask(lessonId: string, question: string): Promise<ApiResult<{ id: string; answer: string }>>
  history(lessonId: string): Promise<ApiResult<Array<{ question: string; answer: string; created_at: string }>>>
  /** 批B: recent exchanges across lessons (qa tab empty state, newest first). */
  recent(): Promise<ApiResult<QaRecentInfo[]>>
}

/** Bilibili source bridge (plan 2026-09-06): QR login + import + session state. */
export interface BilibiliPageInfo {
  page: number
  cid: number
  part: string
  duration: number
}

export interface BilibiliResolveResult {
  bvid: string
  requestedPage: number | null
  title: string
  coverUrl: string
  /** Cover proxied through main as a data URL (CSP img-src is 'self' data:); null → monogram fallback. */
  coverDataUrl?: string | null
  upMid: number | null
  upName?: string | null
  pages: BilibiliPageInfo[]
}

export interface BilibiliBridge {
  /** Starts a QR login; `qrUrl` is the string the renderer draws as a QR image. */
  login(): Promise<ApiResult<{ qrUrl: string }>>
  /** One throttled poll; `confirmed` means the encrypted session is already saved. */
  loginStatus(): Promise<ApiResult<{ status: 'inactive' | 'waiting' | 'scanned' | 'confirmed' | 'expired' }>>
  logout(): Promise<ApiResult<{ state: 'logged_in' | 'logged_out' }>>
  session(): Promise<ApiResult<{ state: 'logged_in' | 'logged_out'; savedAt?: string | null }>>
  /** BV/URL/short link → import preview (title + page list). */
  resolve(input: string): Promise<ApiResult<BilibiliResolveResult>>
  /** Persist the course + selected pages; returns lesson ids to queue. */
  import(payload: { bvid: string; pages: number[] }): Promise<ApiResult<{ courseId: string; lessonIds: string[] }>>
}

export interface SeuSummaryBridge {
  school: SchoolBridge
  bilibili: BilibiliBridge
  providers: ProvidersBridge
  tasks: TasksBridge
  notes: NotesBridge
  qa: QaBridge
  settings: SettingsBridge
  log: LogBridge
  /** 声明批6: 反馈入口（只给入口、不上报）。 */
  feedback: FeedbackBridge
}
