/**
 * IPC API surface: thin handlers over the AppContext.
 * Each handler validates argument shapes and converts provider/school
 * errors into { ok:false, error, kind } envelopes the renderer can show.
 *
 * Task execution is asynchronous: tasks:runAsync enqueues and returns
 * immediately; stage progress is pushed to the main window over the
 * 'tasks:progress' channel so the renderer never blocks.
 */
import { ipcMain, dialog, shell, app, BrowserWindow, type WebContents, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { lookup as dnsLookup } from 'dns/promises'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, renameSync } from 'fs'
import { randomUUID } from 'crypto'
import { join, dirname, sep, resolve } from 'path'
import type { AppContext } from './app-context'
import type { Db } from './db/open'
import { isFakeIpResolution } from './net-diagnostics'
import { TaskRepository, runTask, type TaskProgress } from './tasks/queue'
import { createExecutors } from './tasks/orchestrator'
import { resolveResumeStage, type ResumeDecision } from './tasks/resume'
import { PIPELINE_STAGES, stagePercent, type Stage } from './tasks/stages'
import type { StageExecutor } from './tasks/queue'
import { assembleContext, buildQaMessages, recordQa } from './notes/qa'
import { listAttachmentManifest, readAttachmentData, readLessonCover } from './notes/attachments'
import { saveLessonCover } from './notes/cover'
import { buildBilibiliSourceUrl, isValidBilibiliBvid } from './bilibili/source-url'
import { summarizeLesson, loadSummarizeInputs, transcriptHitRateFor, transcriptRangeFor, loadValidRefs, loadCleanSegments, repairStoredNote } from './notes/summarize'
import { polishNote } from './notes/polish'
import { FEEDBACK_TAGS } from '../shared/feedback-tags'
import { printToPdfFile } from './notes/pdf-export'
import { parseNote } from '../shared/notes/schema'
import { noteHealth } from '../shared/notes/health'
import { evidenceHitRate } from '../shared/notes/evidence'
import { noteToMarkdown } from '../shared/notes/markdown'
import { treeToSvg } from '../shared/notes/mindmap-svg'
import { mergeCourseTree } from '../shared/notes/course-tree'
import { ankiDecks, deckToTsv } from '../shared/notes/anki'
import { noteExportBaseName } from '../shared/notes/export-name'
import { exportLessonToObsidian, exportCourseToObsidian, resolveObsidianVault } from './notes/obsidian-export'
import { okResult, errResult, type ApiResult } from '../shared/api-result'
import { formatBytes, formatSpeed } from '../shared/format'
import { DISCLAIMER_TEXT_VERSION } from '../shared/disclaimer'
import { COPYRIGHT_NOTICE_VERSION } from '../shared/copyright-notice'
import { FEEDBACK_FORM_URL } from '../shared/feedback'
import { AUTHOR_GITHUB_URL } from '../shared/author'
import type { UpdateController } from './update'
import { buildDiagnostics, type DiagnosticsTask } from './feedback/diagnostics'
import { redactCredentials } from './logger'
import { claimNoteInflight, releaseNoteInflight } from './notes/inflight'
import { upsertLessonCatalog, describeCatalogDrift } from './lessons/catalog'
import type { Note } from '../shared/notes/schema'

/** 批5: PNG 魔数——渲染层传来的位图必须真的是 PNG 才落盘。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 批6 (D4): main 自己通过保存对话框写下、等用户点「打开所在文件夹」的备份路径。
 * 一次性：revealFile 消费后即移除——与 pendingPdfExports 同纪律，渲染层永远
 * 只能 reveal 应用自己刚产出的文件。
 */
const recentLibraryBackups = new Set<string>()

/**
 * 批C (plan 2026-09-18 note-library-reachability): 列表分页。
 * 默认值与整改前一致（笔记 200 / 任务 50），改的是「能不能如实说话」——
 * 返回里带上 total，UI 才知道自己被截断了；要更多走 offset 分页，而不是把上限调大。
 */
const NOTE_LIST_LIMIT = 200
const TASK_LIST_LIMIT = 50
/** 硬帽子：渲染层传什么都不会一次拉爆（分页才是正路）。 */
const LIST_LIMIT_MAX = 500
import { resolveCacheDir, attachmentsPath, dbPath } from './library/paths'
import { migrateLibrary } from './library/migrate'
import { writeLibraryPointer } from './library/pointer'
import { getSetting, SETTINGS_KEYS } from './settings/store'
import { fetchBilibiliLesson } from './bilibili/pipeline'
import { BilibiliApiError } from './bilibili/client'
import { nextPendingChainTask } from './bilibili/chain'
import { biliCourseId, biliLessonId, parseBiliInput } from './bilibili/url-parse'

/** User-tunable page cap (settings key courseListMaxPages); undefined → client default. */
function maxPagesFrom(db: Db): number | undefined {
  const parsed = Number(getSetting(db, 'courseListMaxPages', ''))
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined
}

/**
 * 批3 (P1 评审补口): B 站 view 接口失败 → 人话。
 *
 * `BilibiliClient` 抛的是英文技术串（`bilibili risk control (HTTP 412) for …`），
 * 渲染层把 `res.error` 原样 toast——封面回填的失败路径必须说人话，且每种失败给得出
 * 下一步。风控是最可能的一种（方案 §5：每次点击打一次 view 接口）。
 */
function coverViewErrorMessage(error: unknown): string {
  const kind = error instanceof BilibiliApiError ? error.kind : null
  if (kind === 'risk_control') return 'B 站限流了（风控），请稍后再试'
  if (kind === 'not_found') return 'B 站找不到这个视频，可能已被删除'
  if (kind === 'auth_required' || kind === 'forbidden') return 'B 站要求登录后才能读取视频信息，请先在设置里登录 B 站'
  if (kind === 'network') return '连接 B 站失败，请检查网络后重试'
  return '获取 B 站视频信息失败，请稍后重试'
}

function ok<T>(value: T): ApiResult<T> {
  return okResult(value)
}

function err(error: unknown): ApiResult<never> {
  return errResult(error)
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || v === '') throw new Error(`${name} must be a non-empty string`)
  return v
}

/**
 * H23 (audit 2026-09-28): 导出缝隙 SEU_*_PATH 的打包门。
 *
 * 这四个 env 本是 e2e 测试缝（绕开原生保存对话框、直写夹具路径），注释一直
 * 写着 dev-only，却没有 `app.isPackaged` 门——装机用户的机器上残留一个
 * `SEU_PDF_PATH` 之类变量，导出就会静默写去那个路径、对话框再也不出现。
 * 门形态与 nav-guard.ts 的 rendererDevUrl 一致：打包后一律无视这些变量。
 */
function devExportOverridePath(envName: string): string | null {
  if (app.isPackaged) return null
  const value = process.env[envName]
  return value != null && value !== '' ? value : null
}

/**
 * 批4 (plan 2026-09-20, P14): 能力白名单——providers:bind 与 providers:unbind
 * 共用同一份判定（两处各写一份就是新的漂移：绑得进、解不掉，或者反之）。
 * 2026-09-21 (P25): 能力面收敛为两项，`'text'` 从此也进拒绝集——老库里残留的
 * text 绑定行由 migration 013 清掉，桥面不再接受任何新写入。
 */
function requireCapability(v: unknown): 'asr' | 'multimodal' {
  const capability = str(v, 'capability')
  if (capability !== 'asr' && capability !== 'multimodal') throw new Error('unknown capability')
  return capability
}

/**
 * 批2 (audit 2026-09-19): id 字符校验——凡拼进文件路径或当 DB 行键的入参都先过
 * 这里。纪律沿用 tasks:delete 的既有 inline 校验：首字符必须字母数字，«.» «..»
 * «../x» 因此无法解析到别的目录（join(root, '.') 就是 root 本身）；再补长度上限
 * 防超长键。中文等非 ASCII id 一并拒绝（手动课程 id 请用英文/数字）。
 */
/** 终审修复波: 入参名 → 用户可见中文标签——assertSafeId 报错不再中英混排。 */
const SAFE_ID_LABELS: Record<string, string> = {
  courseId: '课程 ID',
  lessonId: '课时 ID',
  taskId: '任务 ID'
}
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export function assertSafeId(v: unknown, name: string): string {
  const id = str(v, name)
  if (!SAFE_ID_RE.test(id)) throw new Error(`${SAFE_ID_LABELS[name] ?? name} 格式不合法`)
  return id
}

/** Validate a directory is creatable/writable by probing it (U3). */
function assertWritable(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const probe = join(dir, `.seu-write-test-${Date.now()}`)
  writeFileSync(probe, 'probe')
  rmSync(probe, { force: true })
}

/** Compute the resume decision for a task: failed tasks resume from their
 *  failed stage — degraded to the earliest stage that can rebuild missing
 *  inputs (review B1: expired URLs / reaped audio / moved cache dirs used
 *  to dead-end in a permanent failure loop); fresh tasks start from the top. */
function resumeDecisionFor(ctx: AppContext, row: { state: string; failed_stage: string | null }, taskId: string): ResumeDecision {
  if (row.state === 'failed' && row.failed_stage != null) {
    return resolveResumeStage(ctx.db, taskId, row.failed_stage as Parameters<typeof runTask>[3])
  }
  return { stage: 'fetching_course', note: '' }
}

/** Progress-channel interface so tests can substitute a fake sender.
 *  Payload is widened to object: the channel carries task progress and
 *  refresh progress (school:refreshProgress) alike. */
export interface ProgressSender {
  send: (channel: string, payload: object) => void
}

/** Minimal handle surface shared by ipcMain and the test doubles. */
export interface HandleLike {
  handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void
}

/**
 * 批1 (audit 2026-09-19): the renderer entry URL, computed once at startup and
 * injected by index.ts (setAppRendererOrigin, before registerIpc).
 * assertAppSender compares file:// callers against it EXACTLY.
 */
let appRendererUrl: string | null = null

/** Inject the app renderer's own entry URL (index.ts, app.whenReady). */
export function setAppRendererOrigin(url: string): void {
  appRendererUrl = url
}

/**
 * E1 (review): every handler verifies the caller is the app's own renderer.
 * While the main window is navigated to the school platform, its pages load
 * WITH the preload bridge attached — without this check they could reach
 * the full IPC surface (providers:save, settings writes, PDF export…).
 * 批1（契约有意变更）：file:// 不再整体放行——只认启动时注入的那个 renderer
 * 入口 URL；dev 分支保留前缀放行且仅限未打包（与 nav-guard 同一口径）。
 */
export function assertAppSender(e: unknown): void {
  const frame = (e as { senderFrame?: { url?: string } | null } | undefined)?.senderFrame
  const url = frame?.url ?? ''
  if (url.startsWith('file://')) {
    if (appRendererUrl != null && url === appRendererUrl) return
    throw new Error('非法调用方：该通道仅限应用自身界面调用')
  }
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl != null && devUrl !== '' && url.startsWith(devUrl)) return
  throw new Error('非法调用方：该通道仅限应用自身界面调用')
}

function handle(target: HandleLike, channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void {
  // Re-registration safety (health audit 2026-09-12): main/index.ts re-runs
  // registerIpc when the window is recreated (app 'activate'), and Electron
  // throws «Attempted to register a second handler» without this. Real
  // ipcMain has removeHandler; test doubles without it keep working as-is.
  if ('removeHandler' in target && typeof target.removeHandler === 'function') target.removeHandler(channel)
  target.handle(channel, (e, ...args) => {
    assertAppSender(e)
    return fn(e, ...args)
  })
}

export interface IpcOptions {
  /** Main window webContents; progress events go here when present. */
  sender?: ProgressSender
  /** Overrides the auto task id (used by tests for determinism). */
  newTaskId?: () => string
  /** Test hook: replace the pipeline executors (progress tests stub stages). */
  executorsOverride?: () => Record<Stage, StageExecutor>
  /** Test hook: fake-IP preflight lookup so tests never touch real DNS. */
  netLookupOverride?: (host: string) => Promise<Array<{ address: string }>>
  /** Test hook: provider connectivity probe (tests avoid real HTTP). */
  providerTestOverride?: (baseUrl: string, apiKey: string, model: string) => Promise<{ latencyMs: number; answer: string }>
  /** 2026-09-30: 更新控制器——index.ts 用真实 electron-updater 装配，测试给假的；
   *  不提供时更新通道如实回答 unsupported（老测试/不带更新的构建不会因此红）。 */
  updateController?: UpdateController
}

export interface IpcHandle {
  /** True while any task occupies the serial queue, running or queued (close-window confirm). */
  isTaskRunning: () => boolean
  /** Abort/cancel every running and queued task (close-window «取消任务并退出»). */
  cancelRunning: () => void
  /** D4: fired when the queue transitions to empty (last task finished/was cancelled). */
  onQueueIdle: (cb: () => void) => () => void
}

export function registerIpc(ctx: AppContext, ipc = ipcMain, options: IpcOptions = {}): IpcHandle {
  // H7 (audit 2026-09-28): 队列/取消控制器/PDF 令牌/排空监听都来自 ctx（见
  // app-context.ts 的 IpcTaskRuntime）。以前它们是本函数的闭包状态，而
  // index.ts 的 app 'activate' 会再次 registerIpc——二次注册换一套新状态后，
  // 旧任务的 isTaskRunning() 返回 false（关窗确认失灵）、cancelRunning() 遍历
  // 空队列（取消无效）、setCacheDir 在跑守卫误判放行（半途换缓存根）。
  const queue = ctx.taskRuntime.queue
  const abortControllers = ctx.taskRuntime.abortControllers
  const pendingPdfExports = ctx.taskRuntime.pendingPdfExports
  const idleListeners = ctx.taskRuntime.idleListeners
  // D1: queue cap, mirroring the renderer's B1 guard (main is the authority).
  const MAX_QUEUED_TASKS = 3
  // D4: notified when the queue drains (tray restores the window).
  const notifyIdle = (): void => {
    if (queue.members().length === 0) {
      for (const cb of idleListeners) {
        try {
          cb()
        } catch {
          // A listener failure must not break task execution.
        }
      }
    }
  }

  const sendProgress = (p: TaskProgress): void => {
    if (p.state === 'failed') {
      ctx.logger.error(`task ${p.taskId} failed at stage ${p.stage ?? '-'} (${p.kind ?? 'generic'}): ${p.message}`)
    }
    options.sender?.send('tasks:progress', p)
  }

  const makeExecutors = (): Record<Stage, StageExecutor> =>
    options.executorsOverride?.() ??
    createExecutors({
      db: ctx.db,
      libraryRoot: ctx.libraryRoot,
      cacheDir: ctx.cacheDir,
      ffmpeg: ctx.ffmpegPath(),
      ffprobe: ctx.ffprobePath(),
      school: ctx.school,
      chat: (capability) => ctx.chatFor(capability),
      gridDecoder: ctx.gridDecoder,
      fetchBilibili: ({ bvid, page, signal }) => fetchBilibiliLesson(ctx.bilibili, bvid, page, signal),
      harvestLesson: (input) =>
        ctx.harvestCoursePage(
          { courseId: input.courseId, teclId: input.teclId, teclCode: input.teclCode },
          input.selectLessonRef,
          input.signal
        ),
      // 2026-09-21（批1 评审补口）：任务侧 catalog refresh 冻结下来的漂移条目
      // 与收割侧同一形态落日志——「不覆盖」不等于「不吭声」。
      onCatalogDrift: (courseId, drifted) => {
        for (const drift of drifted) ctx.logger.info(`task catalog drift (kept): course=${courseId} ${describeCatalogDrift(drift)}`)
      },
      // H27 (audit 2026-09-28): orchestrator 自己没有 logger，静默降级
      // （PPT 抓取失败归零 / 缩略图 spawn 回落 / 生成前丢图）经这里落 warn。
      onSilentDegrade: (message) => ctx.logger.warn(message),
      onChunkProgress: (taskCtx, index, total) => {
        const base = stagePercent('transcribing')
        const span = stagePercent('extracting_visuals') - base
        sendProgress({
          taskId: taskCtx.taskId,
          state: 'transcribing',
          stage: 'transcribing',
          message: `转写分片 ${index + 1}/${total}`,
          percent: Math.min(100, Math.round(base + ((index + 1) / total) * span))
        })
      },
      // M1-3: remux download byte/speed polling → progress detail line.
      onDownloadProgress: (taskCtx, bytes, bytesPerSecond) => {
        sendProgress({
          taskId: taskCtx.taskId,
          state: 'downloading_video',
          stage: 'downloading_video',
          message: '正在下载视频',
          percent: stagePercent('downloading_video'),
          detail: `已下载 ${formatBytes(bytes)}${formatSpeed(bytesPerSecond) === '' ? '' : ` · ${formatSpeed(bytesPerSecond)}`}`
        })
      }
    })

  const newId = options.newTaskId ?? (() => `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  // ---- school session ----
  handle(ipc, 'school:login', async () => {
    try {
      await ctx.login()
      return ok({ state: ctx.sessionState() })
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'school:logout', async () => {
    try {
      await ctx.logout()
      return ok({ state: ctx.sessionState() })
    } catch (e) {
      return err(e)
    }
  })
  // justLoggedIn is the one-shot «a login flow just completed» marker: the
  // renderer's fresh mount (after the in-window login navigation) uses it to
  // auto-refresh the course tree. savedAt/expiresAt feed the settings page
  // and the «已过期» badge (local JWT-exp judgement, no network).
  handle(ipc, 'school:session', () => {
    const meta = ctx.sessionMeta()
    return ok({
      state: ctx.sessionState(),
      justLoggedIn: ctx.consumeLoginJustCompleted(),
      loginOutcome: ctx.consumeLoginOutcome(),
      savedAt: meta.savedAt,
      expiresAt: meta.expiresAt
    })
  })

  // ---- bilibili (source #2, plan 2026-09-06 M3) ----
  // QR login: start returns the QR content URL (renderer draws the image);
  // loginStatus is polled ~1.5s apart and reports the scan state machine.
  // Confirmed already persists the DPAPI-sealed session in the main side.
  handle(ipc, 'bilibili:login', async () => {
    try {
      return ok(await ctx.bilibiliLoginStart())
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'bilibili:loginStatus', async () => {
    try {
      return ok(await ctx.bilibiliLoginPoll())
    } catch (e) {
      return err(e)
    }
  })
  // 批3 (audit 2026-09-28, H6 同族): 66 个 handler 里最后一个裸奔的——
  // clearBilibiliSession 的 rmSync 撞上 EPERM/EBUSY（文件被占用）时会 reject 成
  // 裸异常跨桥，渲染层拿到的是异常而不是 ApiResult 信封。与其它 handler 对齐。
  handle(ipc, 'bilibili:logout', () => {
    try {
      ctx.bilibiliLogout()
      return ok({ state: ctx.bilibiliSessionState() })
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'bilibili:session', () => {
    return ok({ state: ctx.bilibiliSessionState(), savedAt: ctx.bilibiliSessionMeta().savedAt })
  })

  // Import preview (plan 2026-09-06 M5): BV/URL/short link → video metadata
  // + the page list the user picks from. Works logged out (subtitles need a
  // login only at fetch time).
  handle(ipc, 'bilibili:resolve', async (_e, input: unknown) => {
    try {
      const raw = str(input, 'input')
      const parsed = parseBiliInput(raw)
      if (parsed == null) throw new Error('无法识别的B站链接，请粘贴视频页链接或 BV 号')
      let bvid: string
      let requestedPage: number | null = null
      if (parsed.kind === 'short_link') {
        const resolved = await ctx.bilibili.resolveShortLink(raw)
        const reparsed = parseBiliInput(resolved)
        if (reparsed?.kind !== 'bvid') throw new Error('短链解析后未找到 BV 号')
        bvid = reparsed.bvid
        requestedPage = reparsed.page
      } else if (parsed.kind === 'av_unsupported') {
        throw new Error('暂不支持 av 号，请使用 BV 号或视频页链接')
      } else {
        bvid = parsed.bvid
        requestedPage = parsed.page
      }
      const view = await ctx.bilibili.viewInfo(bvid)
      if (view.paid) throw new Error('该视频为付费/充电专属内容，不支持导入（合规边界）')
      // Cover thumbnail as a data URL — renderer CSP is img-src 'self' data:,
      // so remote images ride through main. Best-effort: null → monogram fallback.
      const coverDataUrl = view.coverUrl !== '' ? await ctx.bilibili.fetchImageAsDataUrl(view.coverUrl) : null
      return ok({
        bvid,
        requestedPage,
        title: view.title,
        coverUrl: view.coverUrl,
        coverDataUrl,
        upMid: view.upMid,
        upName: view.upName,
        pages: view.pages.map((p) => ({ page: p.page, cid: p.cid, part: p.part, duration: p.duration }))
      })
    } catch (e) {
      return err(e)
    }
  })

  // Import: upsert the course + one lesson per selected P (migration 009
  // shape). The renderer then queues tasks per lesson like any SEU course.
  handle(ipc, 'bilibili:import', async (_e, payload: unknown) => {
    try {
      const body = (payload ?? {}) as { bvid?: unknown; pages?: unknown }
      const bvid = str(body.bvid, 'bvid')
      if (!Array.isArray(body.pages) || body.pages.length === 0) throw new Error('请至少选择一个分P')
      const pageNumbers = body.pages.map((p) => Number(p))
      if (pageNumbers.some((p) => !Number.isInteger(p) || p < 1)) throw new Error('分P序号非法')
      const view = await ctx.bilibili.viewInfo(bvid)
      if (view.paid) throw new Error('该视频为付费/充电专属内容，不支持导入（合规边界）')
      const now = new Date().toISOString()
      const courseId = biliCourseId(bvid)
      const upsertCourse = ctx.db.prepare(
        `INSERT INTO courses (id, name, source, bili_bvid, bili_up_mid, fetched_at) VALUES (?, ?, 'bilibili', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, bili_up_mid = excluded.bili_up_mid, fetched_at = excluded.fetched_at`
      )
      const upsertLesson = ctx.db.prepare(
        `INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, duration_seconds, fetched_at)
         VALUES (?, ?, ?, 'bilibili', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, bili_cid = excluded.bili_cid,
           bili_page = excluded.bili_page, duration_seconds = excluded.duration_seconds, fetched_at = excluded.fetched_at`
      )
      const lessonIds: string[] = []
      ctx.db.transaction(() => {
        upsertCourse.run(courseId, view.title, bvid, view.upMid != null ? String(view.upMid) : null, now)
        for (const pageNumber of pageNumbers) {
          const page = view.pages.find((p) => p.page === pageNumber)
          if (page == null) continue
          const lessonId = biliLessonId(bvid, page.page)
          upsertLesson.run(
            lessonId, courseId, page.part !== '' ? page.part : view.title, String(page.cid),
            page.page, page.duration > 0 ? page.duration : null, now
          )
          lessonIds.push(lessonId)
        }
      })()
      if (lessonIds.length === 0) throw new Error('所选分P在视频中不存在')

      // 批 A2 (plan 2026-09-19): 封面落库。B 站导入时封面 pic 早已解析，此前只活到
      // 导入对话框的预览缩略图——落成 attachments/<lessonId>/cover.jpg，笔记首屏复用。
      // best-effort：封面获取/落盘失败绝不能弄坏导入（SEU 源与失败态都是合法无封面）。
      // 批3 (plan 2026-09-20, P1): 导入日志如实记封面成败——此前这条日志只有
      // pages=N，封面抓失败时界面与日志都不提一个字（用户分不清「平台没给」与「抓失败」）。
      let coverOutcome: 'ok' | 'fetched-failed' | 'skipped' = view.coverUrl === '' ? 'skipped' : 'fetched-failed'
      if (view.coverUrl !== '') {
        const coverDataUrl = await ctx.bilibili.fetchImageAsDataUrl(view.coverUrl).catch(() => null)
        if (coverDataUrl != null) {
          const setCover = ctx.db.prepare('UPDATE lessons SET cover_path = ? WHERE id = ?')
          let stored = 0
          for (const lessonId of lessonIds) {
            const coverPath = saveLessonCover(ctx.libraryRoot, lessonId, coverDataUrl)
            if (coverPath == null) continue
            setCover.run(coverPath, lessonId)
            stored += 1
          }
          if (stored === lessonIds.length) coverOutcome = 'ok'
        }
      }
      ctx.logger.info(`bilibili import: ${courseId} pages=${lessonIds.length} cover=${coverOutcome}`)
      return ok({ courseId, lessonIds })
    } catch (e) {
      return err(e)
    }
  })

  // A5 preflight: a Clash-style TUN resolver answers campus lookups with a
  // Fake-IP and the proxy then RSTs all school traffic. Detecting it before
  // a refresh/login turns «app does nothing» into an actionable message.
  handle(ipc, 'school:netCheck', async () => {
    try {
      const hosts = ['cvs.seu.edu.cn', 'dncvsvod.seu.edu.cn']
      const lookup = options.netLookupOverride ?? ((host: string) => dnsLookup(host, { all: true }))
      const resolved: Array<{ host: string; ip: string }> = []
      for (const host of hosts) {
        for (const entry of await lookup(host)) {
          resolved.push({ host, ip: entry.address })
        }
      }
      return ok({ intercepted: isFakeIpResolution(resolved.map((r) => r.ip)), resolved })
    } catch (e) {
      return err(e)
    }
  })

  // ---- courses / lessons ----
  // The school list is the source; rows are upserted into the library so the
  // course tree (school:courseTree) has durable data even offline.
  // B1: paged refresh — progress events stream via 'school:refreshProgress'
  // and the envelope carries the loaded/total boundary for the UI.
  handle(ipc, 'school:listCourses', async () => {
    try {
      const page = await ctx.school.listCoursesPaged({
        maxPages: maxPagesFrom(ctx.db),
        onProgress: (p) => options.sender?.send('school:refreshProgress', p)
      })
      const now = new Date().toISOString()
      // C1: metadata columns keep their previous value when a fetch record
      // carries none (manual rows and older snapshots must not be blanked).
      const upsert = ctx.db.prepare(
        `INSERT INTO courses (id, name, term, teacher, tecl_id, tecl_code, subj_code, classroom, cour_times, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, term = excluded.term,
           teacher = excluded.teacher, tecl_id = excluded.tecl_id, tecl_code = excluded.tecl_code,
           subj_code = COALESCE(excluded.subj_code, subj_code), classroom = COALESCE(excluded.classroom, classroom),
           cour_times = COALESCE(excluded.cour_times, cour_times), fetched_at = excluded.fetched_at`
      )
      for (const c of page.courses) {
        if (c.id === '') continue
        upsert.run(
          c.id, c.name, c.term ?? null, c.teacher ?? null, c.teclId ?? null, c.teclCode ?? null,
          c.subjCode ?? null, c.classroom ?? null, c.courTimes ?? null, now
        )
      }
      return ok({ loaded: page.courses.length, platformTotal: page.platformTotal, platformPages: page.platformPages })
    } catch (e) {
      return err(e)
    }
  })

  // V1.3: harvest the course's «第N节课» catalog from the play page DOM in
  // the main window (navigates away and back). Fire-and-forget from the
  // renderer — the window unloads mid-call; the fresh mount re-reads the
  // tree and shows the harvested lessons.
  handle(ipc, 'school:harvestLessons', async (_e, courseId: unknown) => {
    // 批5: start 返回本次调用是否新拿到在途归属——第二个同课时的调用会被
    // 单飞拒绝，它的 catch 不能 finish（那会清掉第一次仍在途的标识并覆盖
    // 其 outcome），只有持有者能收尾。
    let ownsHarvest = false
    try {
      const cid = assertSafeId(courseId, 'courseId')
      ownsHarvest = ctx.harvestRuntime.start(cid)
      const course = ctx.db.prepare('SELECT id, tecl_id, tecl_code FROM courses WHERE id = ?').get(cid) as
        | { id: string; tecl_id: string | null; tecl_code: string | null }
        | undefined
      if (course?.tecl_id == null || course?.tecl_code == null) {
        throw new Error('课程缺少录播课时标识（teclId/teclCode），请先刷新课程列表')
      }
      const harvest = await ctx.harvestCoursePage({ courseId: cid, teclId: course.tecl_id, teclCode: course.tecl_code })
      const now = new Date().toISOString()
      const keepIds = harvest.lessons.map((entry) => `${cid}-L${entry.index}`)
      // 批1 (plan 2026-09-20, D1 推荐侧): a lesson that has already produced
      // anything — notes, transcripts, keyframes, PPT pages, tasks or Q&A —
      // is never deleted by a harvest and never gets its title/play_ref
      // overwritten. The platform list shifts as lessons are added, so a
      // shorter harvest is NOT evidence the lesson is gone; the same rule
      // removeCourse already follows («该课程已有笔记，为保护数据不允许删除»).
      // 判定与写法在 lessons/catalog.ts —— 任务侧的 catalog refresh 共用同一份
      // （评审补口 2026-09-21：两条 writer 语义必须一致，否则这边刚冻结、
      // 下一次任务运行就把它重新踩回去）。
      const driftLog: string[] = []
      const harvestCounts = ctx.db.transaction(() => {
        const catalog = upsertLessonCatalog(ctx.db, cid, harvest.lessons, now)
        for (const drift of catalog.drifted) driftLog.push(describeCatalogDrift(drift))
        // The platform list shifts as lessons are added: drop previously
        // harvested rows that this harvest no longer covers (an empty
        // harvest keeps everything — likely a page-change anomaly). Rows with
        // produced artifacts are excluded from the delete on top of that.
        if (keepIds.length === 0) return { dropped: 0, keptProtected: catalog.protectedRows.length }
        const protectedClause =
          catalog.protectedRows.length > 0 ? ` AND id NOT IN (${catalog.protectedRows.map(() => '?').join(',')})` : ''
        const deleted = ctx.db
          .prepare(
            `DELETE FROM lessons WHERE course_id = ? AND id LIKE ? AND id NOT IN (${keepIds.map(() => '?').join(',')})${protectedClause}`
          )
          .run(cid, `${cid}-L%`, ...keepIds, ...catalog.protectedRows.map((row) => row.id))
        return { dropped: deleted.changes, keptProtected: catalog.protectedRows.length }
      })()
      for (const drift of driftLog) ctx.logger.info(`harvestLessons drift (kept): ${drift}`)
      ctx.logger.info(
        `harvestLessons: course=${cid} entries=${harvest.lessons.length} dropped=${harvestCounts.dropped} keptProtected=${harvestCounts.keptProtected}`
      )
      if (ownsHarvest) ctx.harvestRuntime.finish(cid, { ok: true, lessons: harvest.lessons.length })
      return ok({ lessons: harvest.lessons.length })
    } catch (e) {
      ctx.logger.error(`harvestLessons failed: ${(e as Error).message}`)
      // 批C: the initiating renderer dies with the navigation — the outcome
      // is the only way the fresh mount can tell the user it failed.
      if (ownsHarvest && typeof courseId === 'string') ctx.harvestRuntime.finish(courseId, { ok: false, lessons: 0, error: (e as Error).message })
      return err(e)
    }
  })

  // 批C: harvest visibility for the fresh mount — in-flight course ids plus
  // the last outcome (renderer dedupes repeat toasts via outcome.seq).
  handle(ipc, 'school:harvestState', () => {
    try {
      return ok(ctx.harvestRuntime.state())
    } catch (e) {
      return err(e)
    }
  })

  // Manual fallback entry (spec §2): register a course/lesson by id when the
  // school API list is unavailable. The task's fetching_course stage will
  // pull the real detail later; here we only need durable rows to exist.
  handle(ipc, 'school:addManualCourse', (_e, courseId: unknown, lessonId: unknown) => {
    try {
      const cid = assertSafeId(courseId, 'courseId')
      const lid = assertSafeId(lessonId, 'lessonId')
      const now = new Date().toISOString()
      ctx.db
        .prepare(
          `INSERT INTO courses (id, name, fetched_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO NOTHING`
        )
        .run(cid, `课程 ${cid}`, now)
      ctx.db
        .prepare(
          `INSERT INTO lessons (id, course_id, title, fetched_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`
        )
        .run(lid, cid, `课时 ${lid}`, now)
      return ok({ courseId: cid, lessonId: lid })
    } catch (e) {
      return err(e)
    }
  })

  // Course → lesson tree (U1): one shot payload for the sidebar. Lesson rows
  // come from the DB (auto list or manual fallback); each lesson reports
  // whether a note already exists so the UI can badge processed lessons.
  // M1-4: per-course extracted aggregation («已提取») so the sidebar can
  // float the courses the user actually studied.
  handle(ipc, 'school:courseTree', () => {
    try {
      const courses = ctx.db
        .prepare(
          `SELECT c.id, c.name, c.term, c.teacher, c.subj_code, c.classroom, c.cour_times, c.is_mine, c.source,
                  (SELECT COUNT(*) FROM notes n JOIN lessons nl ON n.lesson_id = nl.id WHERE nl.course_id = c.id) AS note_count,
                  (SELECT MAX(t.updated_at) FROM tasks t JOIN lessons tl ON t.lesson_id = tl.id WHERE tl.course_id = c.id) AS last_task_at
           FROM courses c ORDER BY c.fetched_at DESC`
        )
        .all() as Array<{
        id: string
        name: string
        term: string | null
        teacher: string | null
        subj_code: string | null
        classroom: string | null
        cour_times: string | null
        is_mine: number
        source: string
        note_count: number
        last_task_at: string | null
      }>
      const lessonRows = ctx.db
        .prepare(
          `SELECT l.id, l.course_id, l.title, l.started_at,
                  (SELECT COUNT(*) FROM notes n WHERE n.lesson_id = l.id) AS note_count
           FROM lessons l ORDER BY l.started_at, l.bili_page, l.id`
        )
        .all() as Array<{ id: string; course_id: string; title: string; started_at: string | null; note_count: number }>
      const tree = courses.map((c) => ({
        id: c.id,
        name: c.name,
        term: c.term ?? undefined,
        teacher: c.teacher ?? undefined,
        subjCode: c.subj_code ?? undefined,
        classroom: c.classroom ?? undefined,
        courTimes: c.cour_times ?? undefined,
        isMine: c.is_mine === 1,
        source: c.source === 'bilibili' ? ('bilibili' as const) : ('seu' as const),
        noteCount: c.note_count,
        lastTaskAt: c.last_task_at ?? undefined,
        hasExtracted: c.note_count > 0,
        lessons: lessonRows
          .filter((l) => l.course_id === c.id)
          .map((l) => ({ id: l.id, title: l.title, hasNote: l.note_count > 0 }))
      }))
      return ok(tree)
    } catch (e) {
      return err(e)
    }
  })

  // C6: remove a manually mis-added course — ONLY when nothing was ever
  // processed with it (every table cascades on course delete, so a course
  // with notes/tasks must be refused to protect the data).
  // 批6 (D8 推荐侧): 「任务记录」不再一律挡住删除——只挡在跑/排队中的任务，
  // 或磁盘上仍留着该任务缓存的行（可续跑产物）；failed/cancelled 且无缓存的
  // 行是终态垃圾，不该让误加的课程永远删不掉。
  handle(ipc, 'school:removeCourse', (_e, courseId: unknown) => {
    try {
      const cid = assertSafeId(courseId, 'courseId')
      const noteRow = ctx.db
        .prepare('SELECT COUNT(*) AS n FROM notes n JOIN lessons l ON n.lesson_id = l.id WHERE l.course_id = ?')
        .get(cid) as { n: number }
      const taskRows = ctx.db
        .prepare('SELECT t.id, t.state FROM tasks t JOIN lessons l ON t.lesson_id = l.id WHERE l.course_id = ?')
        .all(cid) as Array<{ id: string; state: string }>
      const cacheRoot = resolveCacheDir(getSetting(ctx.db, 'cacheDir', ''), ctx.libraryRoot)
      // 「磁盘上仍有缓存」= 任务缓存目录存在且非空（可续跑产物还在）。
      const taskCacheOnDisk = (id: string): boolean => {
        const dir = join(cacheRoot, id)
        return existsSync(dir) && readdirSync(dir).length > 0
      }
      if (noteRow.n > 0) {
        throw new Error('该课程已有笔记，为保护数据不允许删除')
      }
      const blocked = taskRows.some((row) =>
        row.state !== 'succeeded' && row.state !== 'failed' ? true : taskCacheOnDisk(row.id)
      )
      if (blocked) {
        // 终审修复波: 「在跑/排队」与「已终态但缓存还在磁盘上」是两种拦截
        // 原因——旧文案一口咬定「缓存仍在磁盘上」，对在跑但无缓存的分支不准确。
        const running = taskRows.some((row) => row.state !== 'succeeded' && row.state !== 'failed')
        throw new Error(
          running
            ? '该课程有进行中或排队中的任务，为保护数据不允许删除'
            : '该课程有已完成任务但缓存仍未清理，为保护数据不允许删除'
        )
      }
      const lessonRows = ctx.db
        .prepare('SELECT id FROM lessons WHERE course_id = ?')
        .all(cid) as Array<{ id: string }>
      ctx.db.transaction(() => {
        ctx.db.prepare('DELETE FROM lessons WHERE course_id = ?').run(cid)
        ctx.db.prepare('DELETE FROM courses WHERE id = ?').run(cid)
      })()
      // 删除级联只覆盖库行；磁盘上的课时附件（关键帧/PPT/封面）由这里回收，
      // 否则删课是附件目录无界增长的漏口。失败不阻塞返回——孤儿目录仍有启动时
      // 24h sweep 兜底（app-context 的 cleanOrphanAttachmentDirs：无 lessons 行
      // 且 mtime > 24h 才删）。
      for (const { id } of lessonRows) {
        try {
          rmSync(join(attachmentsPath(ctx.libraryRoot), id), { recursive: true, force: true })
        } catch (e) {
          ctx.logger.warn(`removeCourse: failed to GC attachments for lesson ${id}: ${(e as Error).message}`)
        }
      }
      ctx.logger.info(`removeCourse: ${cid} (empty course)`)
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // C2: pin/unpin a course as «mine». The schedule-API probe may automate
  // this later; until then the user decides, and the sidebar sorts pinned
  // courses (plus their same-subject sections) to the top.
  handle(ipc, 'school:setMine', (_e, courseId: unknown, mine: unknown) => {
    try {
      const cid = assertSafeId(courseId, 'courseId')
      if (typeof mine !== 'boolean') throw new Error('mine must be a boolean')
      ctx.db.prepare('UPDATE courses SET is_mine = ? WHERE id = ?').run(mine ? 1 : 0, cid)
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // ---- providers ----
  // List never carries the plaintext key: renderer receives shape only
  // (spec §9 — keys are decrypted and used exclusively in main).
  handle(ipc, 'providers:list', () =>
    ok({
      providers: ctx.providers().providers.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, hasKey: p.hasKey })),
      bindings: ctx.providers().bindings
    })
  )
  handle(ipc, 'providers:save', (_e, input: unknown) => {
    try {
      const i = input as { id?: string; name?: string; baseUrl?: string; apiKey?: string }
      const provider = ctx.saveProvider({
        id: i.id,
        name: str(i.name, 'name'),
        baseUrl: str(i.baseUrl, 'baseUrl'),
        apiKey: typeof i.apiKey === 'string' ? i.apiKey : ''
      })
      return ok({ id: provider.id, hasKey: provider.hasKey })
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'providers:delete', (_e, id: unknown) => {
    try {
      ctx.removeProvider(str(id, 'id'))
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'providers:bind', (_e, capability: unknown, providerId: unknown, model: unknown) => {
    try {
      const cap = requireCapability(capability)
      ctx.bind(cap, str(providerId, 'providerId'), str(model, 'model'))
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })
  // 批4 (plan 2026-09-20, P14): 取消勾选的能力随保存解绑——此前渲染层只能绑、
  // 不能解，用户取消勾选后列表徽标与任务管线照旧用它。
  handle(ipc, 'providers:unbind', (_e, capability: unknown) => {
    try {
      ctx.unbind(requireCapability(capability))
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // M3 批 D: provider connectivity probe. Values come from the form in
  // memory only — nothing is stored or logged.
  handle(ipc, 'providers:test', async (_e, input: unknown) => {
    try {
      const i = input as { baseUrl?: string; apiKey?: string; model?: string }
      const baseUrl = str(i.baseUrl, 'baseUrl')
      const model = str(i.model, 'model')
      const apiKey = typeof i.apiKey === 'string' ? i.apiKey : ''
      const probe = options.providerTestOverride ?? (async (url: string, key: string, m: string) => {
        const { OpenAiCompatibleClient } = await import('./providers/openai-client')
        const client = new OpenAiCompatibleClient(url, key)
        const started = Date.now()
        const answer = await client.chat([{ role: 'user', content: '连接测试，请只回复：ok' }], m)
        return { latencyMs: Date.now() - started, answer: answer.slice(0, 40) }
      })
      return ok(await probe(baseUrl, apiKey, model))
    } catch (e) {
      return err(e)
    }
  })

  // ---- settings (U3) ----
  handle(ipc, 'settings:get', () => {
    try {
      const s = ctx.settings()
      // C7: the UI shows the app version in the settings footer.
      // 声明批2: the consent gate's comparison happens HERE, against the
      // shared text version — the renderer never carries a version of its own,
      // so a bumped DISCLAIMER_TEXT_VERSION cannot be missed by the UI.
      return ok({
        libraryRoot: s.libraryRoot,
        cacheDir: resolveCacheDir(s.cacheDir, s.libraryRoot),
        theme: s.theme,
        version: app.getVersion(),
        disclaimerVersion: DISCLAIMER_TEXT_VERSION,
        disclaimerAccepted: s.disclaimerAcceptedVersion === String(DISCLAIMER_TEXT_VERSION),
        // 声明批4: 导出前的版权提醒是否已被用户免除（同样是 main 侧比对版本）。
        copyrightNoticeVersion: COPYRIGHT_NOTICE_VERSION,
        copyrightNoticeOptOut: s.copyrightNoticeVersion === String(COPYRIGHT_NOTICE_VERSION)
      })
    } catch (e) {
      return err(e)
    }
  })
  // 声明批2: record first-run consent together with the TEXT version it was
  // given for. Deliberately takes no argument — the version comes from the
  // shared constant, so the renderer cannot record consent for text it never
  // showed (and a bumped version re-prompts on the next launch).
  handle(ipc, 'settings:acceptDisclaimer', () => {
    try {
      ctx.setSetting(SETTINGS_KEYS.disclaimerAcceptedVersion, String(DISCLAIMER_TEXT_VERSION))
      return ok({ version: DISCLAIMER_TEXT_VERSION })
    } catch (e) {
      return err(e)
    }
  })
  // 声明批4: «不再提示» for the export copyright notice. No argument for the
  // same reason as acceptDisclaimer — the version is main's own constant, so
  // the renderer cannot opt out of a notice it never showed. Called ONLY when
  // the user ticked the box: not ticking means the notice comes back next time.
  handle(ipc, 'settings:optOutCopyrightNotice', () => {
    try {
      ctx.setSetting(SETTINGS_KEYS.copyrightNoticeVersion, String(COPYRIGHT_NOTICE_VERSION))
      return ok({ version: COPYRIGHT_NOTICE_VERSION })
    } catch (e) {
      return err(e)
    }
  })
  // C10: folder picker for the cache dir — hand-typing Windows paths was
  // unfriendly; the chosen path is returned (not saved) for the draft input.
  handle(ipc, 'settings:chooseCacheDir', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const options: OpenDialogOptions = { title: '选择任务缓存目录', properties: ['openDirectory', 'createDirectory'] }
      const { canceled, filePaths } = win == null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options)
      if (canceled || filePaths[0] == null) return ok({ canceled: true })
      return ok({ canceled: false, path: filePaths[0] })
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'settings:setCacheDir', (_e, dir: unknown) => {
    try {
      const d = str(dir, 'cacheDir')
      // 批2 (audit 2026-09-19): 缓存目录承接任务产物落盘——UNC（\\server\share）
      // 会随网络/凭据漂移，任务跑到一半目录不可达就是永久失败；只收本机路径。
      if (d.startsWith('\\\\') || d.startsWith('//')) throw new Error('缓存目录不支持网络路径（UNC），请选择本机磁盘目录')
      // 批1 (plan 2026-09-20, P21): cacheDir 是每次调用重读的设置，而任务的
      // taskDir 也每次重新 join——跑到一半换根会把同一任务的产物劈到新旧两个
      // 目录，旧目录里几 GB 的视频/音频再没有任何入口回收（cleanStaleCache /
      // tasks:delete 都只扫当前 cacheDir）。与 chooseLibrary 同一道守卫：有任务
      // 在跑、排队或未完成（崩溃留下的可续跑行）时拒绝更换。
      const unfinished = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE state NOT IN ('succeeded', 'failed')")
        .get() as { n: number }
      if (queue.members().length > 0 || unfinished.n > 0) {
        throw new Error('有任务在运行、排队或未完成，请先取消或清理任务后再更换缓存目录')
      }
      assertWritable(d)
      ctx.setSetting('cacheDir', d)
      return ok({ cacheDir: resolveCacheDir(d, ctx.settings().libraryRoot) })
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'settings:setTheme', (_e, theme: unknown) => {
    try {
      const t = str(theme, 'theme')
      if (t !== 'auto' && t !== 'light' && t !== 'dark') throw new Error('invalid theme (auto|light|dark)')
      ctx.setSetting('theme', t)
      return ok({ theme: t })
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'settings:chooseLibrary', async () => {
    try {
      // C3 (review): never migrate while the pipeline could write to either
      // library — the guard covers queued tasks AND non-terminal rows left
      // by a crash (their resumable artifacts live in the old cache dir).
      const unfinished = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE state NOT IN ('succeeded', 'failed')")
        .get() as { n: number }
      if (queue.members().length > 0 || unfinished.n > 0) {
        return err(new Error('有任务在运行、排队或未完成，请先取消或清理任务后再迁移'))
      }
      const win = BrowserWindow.getFocusedWindow()
      const dialogOptions: OpenDialogOptions = { title: '选择新的资料库目录（需为空目录）', properties: ['openDirectory', 'createDirectory'] }
      const result = win == null ? await dialog.showOpenDialog(dialogOptions) : await dialog.showOpenDialog(win, dialogOptions)
      if (result.canceled || result.filePaths.length === 0) return ok({ canceled: true })
      const migration = await migrateLibrary(ctx.db, ctx.libraryRoot, result.filePaths[0] as string, {
        onProgress: (copied, total) => {
          options.sender?.send('library:migrationProgress', { copied, total })
        }
      })
      if (!migration.ok) return err(new Error(migration.error))
      // C1 (review): the pointer lives in userData, outside the library,
      // where the next launch actually reads it. The old code wrote the
      // destination into the OLD library's settings table, which no startup
      // code ever read back — the migration silently never took effect.
      writeLibraryPointer(ctx.userDataDir, migration.dest)
      ctx.logger.info(`library migrated to ${migration.dest} (pointer updated)`)
      return ok({ canceled: false, libraryRoot: migration.dest, restartRequired: true })
    } catch (e) {
      return err(e)
    }
  })
  // 批6 (D4): 资料库备份导出——独立入口（与迁移「不产 .bak、靠源库兜底」的
  // 口径分开）。db.backup 是 better-sqlite3 内置的 WAL 一致快照 API（迁移复用的
  // 同一原语），写到用户自选路径；只备份数据库文件，关键帧/PPT 等附件不在内。
  // 失败或取消都不留半成品文件。
  handle(ipc, 'settings:exportLibraryBackup', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const stamp = new Date().toISOString().slice(0, 10)
      const options: SaveDialogOptions = {
        title: '备份资料库数据库',
        defaultPath: join(ctx.exportsDir(), `seu-summary-backup-${stamp}.db`),
        filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
      }
      const { canceled, filePath } = win == null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options)
      if (canceled || filePath == null) return ok({ canceled: true })
      // 修复轮 I2: 拒绝备份到活库自身——备份到正在写的库没有意义还会自溃
      // （SQLITE_BUSY / 半途截断），用户看到一个「成功」的坏备份比报错更糟。
      const samePath = (a: string, b: string): boolean =>
        process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
      if (samePath(filePath, dbPath(ctx.libraryRoot))) {
        throw new Error('不能把备份存进正在使用的资料库文件本身，请另选一个位置')
      }
      // 修复轮 I2: 备份落 .tmp、成功才 renameSync 落位——失败只清自己的
      // .tmp，用户预存在目标路径上的文件必须原样留下（旧实现会删掉它）。
      const tmpPath = `${filePath}.tmp`
      try {
        await ctx.db.backup(tmpPath)
        renameSync(tmpPath, filePath)
      } catch (e) {
        try {
          rmSync(tmpPath, { force: true })
        } catch {
          // Best-effort clean-up; the error below is what the user should see.
        }
        throw new Error(`备份失败：${(e as Error).message}`)
      }
      recentLibraryBackups.add(filePath)
      ctx.logger.info(`library backup written: ${filePath}`)
      return ok({ canceled: false, path: filePath })
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'settings:openPath', async (_e, kind: unknown) => {
    try {
      const k = str(kind, 'kind')
      const s = ctx.settings()
      const target =
        k === 'cache'
          ? resolveCacheDir(s.cacheDir, s.libraryRoot)
          : k === 'exports'
            ? ctx.exportsDir()
            : k === 'logs'
              ? ctx.logsDir()
              : s.libraryRoot
      // shell.openPath resolves to an error string («» on success) instead of
      // rejecting — swallowing it used to leave a deleted/locked directory
      // click with zero feedback.
      const openError = await shell.openPath(target)
      if (openError !== '') {
        ctx.logger.warn(`openPath failed for ${k}: ${openError}`)
        return err(new Error(`无法打开${k === 'cache' ? '缓存' : k === 'exports' ? '导出' : k === 'logs' ? '日志' : '资料库'}目录：${openError}`))
      }
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // 2026-09-21: 作者的 GitHub 主页。与 feedback:openForm 同款——**不接参数**，
  // 地址只存在于 main 侧（渲染层无法让 main 打开任意 URL，AGENTS.md 安全红线）。
  handle(ipc, 'settings:openAuthor', async () => {
    try {
      await shell.openExternal(AUTHOR_GITHUB_URL)
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // ---- logging (U5): renderer errors reach the same redacted file log ----
  handle(ipc, 'log:rendererError', (_e, message: unknown) => {
    try {
      ctx.logger.error(`renderer: ${str(message, 'message')}`)
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // ---- 声明批6: 测试期问题反馈通道 ----
  //
  // 红线：这里只做两件不需要网络的事——把一段**已脱敏**的诊断文本交给渲染层
  // （进用户自己的剪贴板），以及用 main 自己的常量打开反馈表。**不上报任何数据。**
  //
  // feedback:openForm 故意**不接参数**：地址只存在于 main 侧，渲染层无法让 main
  // 打开任意 URL（否则就是一个 openExternal 注入洞）。沿用 settings:openPath 的
  // 枚举/无参先例。
  handle(ipc, 'feedback:openForm', async () => {
    try {
      await shell.openExternal(FEEDBACK_FORM_URL)
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'feedback:diagnostics', (_e, taskId: unknown) => {
    try {
      const id = assertSafeId(taskId, 'taskId')
      const row = ctx.db
        .prepare(
          'SELECT t.id, t.state, t.failed_stage, t.error_message, t.error_kind, t.created_at, t.updated_at, l.title AS lesson_title, c.name AS course_name, c.source AS source FROM tasks t LEFT JOIN lessons l ON t.lesson_id = l.id LEFT JOIN courses c ON l.course_id = c.id WHERE t.id = ?'
        )
        .get(id) as DiagnosticsTask | undefined
      const text = buildDiagnostics({
        version: app.getVersion(),
        platform: `${process.platform} ${process.arch}`,
        logsDir: ctx.logsDir(),
        task: row ?? null
      })
      // Second redaction pass: this text leaves the app on the user's clipboard,
      // so a credential leak here is worse than one sitting in a log file.
      // 批3 (P23 评审补口): 这一支刻意**不折绝对路径**——日志目录正是开发者唯一能用
      // 来找日志的线索（tests/ipc-feedback.test.ts 有钉住断言），而路径不是凭据；
      // 日志侧走的是带路径折叠的 redact()。
      return ok({ text: redactCredentials(text) })
    } catch (e) {
      return err(e)
    }
  })

  // ---- 2026-09-30: 更新检查（plan 2026-09-30-public-release-autoupdate）----
  //
  // 红线同 feedback:openForm——三个通道**都不接 URL**：更新源钉死在
  // src/main/update.ts 的 UPDATE_FEED（github / Andiii208 / flash-summary），
  // 渲染层传任何参数都不能改变它。检查只在用户点了「检查更新」之后发生，
  // 没有后台任务、没有定时器（spec §9 Update check 条）。
  registerUpdateHandlers(ipc, options.updateController, options.sender)

  // ---- tasks ----
  handle(ipc, 'tasks:create', (_e, lessonId: unknown) => {
    try {
      const id = newId()
      new TaskRepository(ctx.db).create(id, assertSafeId(lessonId, 'lessonId'))
      return ok({ id })
    } catch (e) {
      return err(e)
    }
  })
  /**
   * 批C (plan 2026-09-18 note-library-reachability): 列表分页参数。
   * 默认值保持与整改前一致（笔记 200 / 任务 50），上限给一个硬帽子——渲染层传什么
   * 都不可能一次拉爆（分页走 offset，不是把上限调大）。
   */
  const readPage = (raw: unknown, fallbackLimit: number): { limit: number; offset: number } => {
    const obj = (raw ?? {}) as { limit?: unknown; offset?: unknown }
    const rawLimit = typeof obj.limit === 'number' && Number.isFinite(obj.limit) ? Math.trunc(obj.limit) : fallbackLimit
    const rawOffset = typeof obj.offset === 'number' && Number.isFinite(obj.offset) ? Math.trunc(obj.offset) : 0
    return { limit: Math.min(LIST_LIMIT_MAX, Math.max(1, rawLimit)), offset: Math.max(0, rawOffset) }
  }

  // tasks:list (U1): history so the UI can show past/failed tasks.
  // M1-2: JOIN lessons/courses so rows read as «课程名 · 课时名» — the raw
  // lesson id means nothing to a user.
  handle(ipc, 'tasks:list', (_e, lessonId: unknown, rawPage: unknown) => {
    try {
      const baseSelect =
        'SELECT t.id, t.lesson_id, t.state, t.failed_stage, t.error_message, t.error_kind, t.created_at, t.updated_at, l.title AS lesson_title, c.name AS course_name, c.teacher AS teacher, c.cour_times AS courTimes, c.classroom AS classroom FROM tasks t LEFT JOIN lessons l ON t.lesson_id = l.id LEFT JOIN courses c ON l.course_id = c.id'
      const { limit, offset } = readPage(rawPage, TASK_LIST_LIMIT)
      const scoped = lessonId != null
      const scopeArgs = scoped ? [assertSafeId(lessonId, 'lessonId')] : []
      // 批C: 总数与页用**同一个 WHERE 子句**（口径漂移过一次就再也对不上）。
      const total = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM tasks t ${scoped ? 'WHERE t.lesson_id = ?' : ''}`).get(...scopeArgs) as { n: number }).n
      const rows = ctx.db
        .prepare(`${baseSelect} ${scoped ? 'WHERE t.lesson_id = ?' : ''} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`)
        .all(...scopeArgs, limit, offset) as Array<{
        id: string
        lesson_id: string
        state: string
        failed_stage: string | null
        error_message: string | null
        error_kind: string | null
        created_at: string
        updated_at: string
        lesson_title: string | null
        course_name: string | null
        teacher: string | null
        courTimes: string | null
        classroom: string | null
      }>
      return ok({ items: rows, total, limit })
    } catch (e) {
      return err(e)
    }
  })

  // M1-2: delete one history row (and its stage evidence + cache dir).
  // A running task cannot be deleted — cancel it first.
  handle(ipc, 'tasks:delete', (_e, taskId: unknown) => {
    try {
      const id = assertSafeId(taskId, 'taskId')
      const row = new TaskRepository(ctx.db).get(id)
      if (row == null) throw new Error('任务不存在')
      if (row.state !== 'succeeded' && row.state !== 'failed') throw new Error('任务尚未结束，请先取消再删除')
      ctx.db.prepare('DELETE FROM task_stage_outputs WHERE task_id = ?').run(id)
      ctx.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      const dir = join(resolveCacheDir(getSetting(ctx.db, 'cacheDir', ''), ctx.libraryRoot), id)
      rmSync(dir, { recursive: true, force: true })
      ctx.logger.info(`task deleted: ${id}`)
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // M1-2: clear every terminal-state row (succeeded/failed) with evidence
  // and cache cleanup. Returns the number of removed rows.
  handle(ipc, 'tasks:clearFinished', () => {
    try {
      const rows = ctx.db
        .prepare("SELECT id FROM tasks WHERE state IN ('succeeded', 'failed')")
        .all() as Array<{ id: string }>
      if (rows.length === 0) return ok({ removed: 0 })
      const cacheRoot = resolveCacheDir(getSetting(ctx.db, 'cacheDir', ''), ctx.libraryRoot)
      ctx.db.transaction(() => {
        for (const { id } of rows) {
          ctx.db.prepare('DELETE FROM task_stage_outputs WHERE task_id = ?').run(id)
          ctx.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
        }
      })()
      for (const { id } of rows) {
        rmSync(join(cacheRoot, id), { recursive: true, force: true })
      }
      ctx.logger.info(`cleared ${rows.length} finished tasks`)
      return ok({ removed: rows.length })
    } catch (e) {
      return err(e)
    }
  })
  // Enqueue + run one task; shared by tasks:runAsync and the bilibili chain.
  const launchTask = (id: string, controller: AbortController, repo: TaskRepository): void => {
    void queue
      .enqueue(id, async () => {
        // 出队复检：排队期间被取消的任务不执行。cancelById 对在跑/排队任务都是
        // 先 abort 控制器（排队任务的控制器在建 task 时就已注册），所以这里的
        // 真正兜底是 runTask 首轮的 signal.aborted 复检（tasks/queue.ts:134）——
        // 旧代码另有一个 cancelledWhileQueued 集合做前置短路，但 cancelById 永远
        // 先拿到控制器就 return，那个集合从来进不了值（死代码，audit 2026-09-28
        // 批3c 删除，此处注释即钉子）。
        const current = repo.get(id)
        if (current == null) throw new Error(`task ${id} not found`)
        // Decide at DEQUEUE time, not enqueue: a queued wait can outlive
        // URL freshness or see files reaped — re-read the row here.
        const decision = resumeDecisionFor(ctx, current, id)
        if (decision.note !== '') {
          ctx.logger.warn(`task ${id} resume degraded: ${decision.note}`)
          sendProgress({ taskId: id, state: decision.stage, stage: decision.stage, message: decision.note, percent: 0 })
        }
        return runTask(repo, id, makeExecutors(), decision.stage, sendProgress, controller.signal)
      })
      .then((state) => {
        // B站课程自动续链 (usability pass 2026-09-07): after a bilibili task
        // succeeds, the next pending row of the same course auto-starts.
        // The import creates one pending row per selected P — the rows
        // themselves are the chain state, visible and cancellable.
        if (state === 'succeeded') chainNextBiliTask(id)
        return state
      })
      .catch((e) => {
        sendProgress({ taskId: id, state: 'failed', stage: null, message: (e as Error).message, percent: 0 })
        // 批5: 抛到这里的任务行（入队前/出队复检/prepare 阶段炸掉）runTask
        // 根本没来得及 markFailed——只推事件会留下永久非终态行，UI 再也删不
        // 掉它。仍存在且非终态的行在这里补一刀。
        const row = new TaskRepository(ctx.db).get(id)
        if (row != null && row.state !== 'succeeded' && row.state !== 'failed') {
          new TaskRepository(ctx.db).markFailed(
            id,
            PIPELINE_STAGES.includes(row.state as Stage) ? (row.state as Stage) : null,
            (e as Error).message
          )
        }
      })
      .finally(() => {
        abortControllers.delete(id)
        notifyIdle()
      })
  }

  /** Auto-start the next pending task of the finished task's bilibili course. */
  const chainNextBiliTask = (finishedTaskId: string): void => {
    const finished = new TaskRepository(ctx.db).get(finishedTaskId)
    if (finished == null) return
    const next = nextPendingChainTask(ctx.db, finished.lesson_id)
    if (next == null) return
    if (queue.members().length >= MAX_QUEUED_TASKS) {
      ctx.logger.warn(`bilibili chain paused (queue full): ${next.lessonId}`)
      return
    }
    const controller = new AbortController()
    abortControllers.set(next.taskId, controller)
    sendProgress({ taskId: next.taskId, state: 'pending', stage: null, message: '自动续跑下一分P', percent: 0 })
    ctx.logger.info(`bilibili chain: auto-start ${next.taskId} (${next.lessonId})`)
    launchTask(next.taskId, controller, new TaskRepository(ctx.db))
  }

  // tasks:runAsync (U4): enqueued on the serial executor (at most one task
  // runs at a time); progress streams via 'tasks:progress'. Errors surface
  // as a failed progress event plus the returned envelope.
  handle(ipc, 'tasks:runAsync', async (_e, taskId: unknown) => {
    try {
      const id = assertSafeId(taskId, 'taskId')
      const repo = new TaskRepository(ctx.db)
      const row = repo.get(id)
      if (row == null) throw new Error(`task ${id} not found`)
      // D1 (review): the queue invariants live here, not only in the
      // renderer — bounded queue, one task per lesson, no duplicates.
      const activeCount = queue.members().length
      const queuedSameLesson = ctx.db
        .prepare(
          "SELECT COUNT(*) AS n FROM tasks WHERE lesson_id = ? AND state NOT IN ('succeeded', 'failed') AND id != ?"
        )
        .get(row.lesson_id, id) as { n: number }
      if (queuedSameLesson.n > 0) throw new Error('该课时已有任务在排队/运行中')
      if (activeCount >= MAX_QUEUED_TASKS) throw new Error(`已有 ${MAX_QUEUED_TASKS} 个任务在排队/运行，等一个完成再排吧`)
      if (queue.members().includes(id)) throw new Error('该任务已在队列中')
      const controller = new AbortController()
      abortControllers.set(id, controller)
      void launchTask(id, controller, repo)
      return ok({ id, state: 'running' })
    } catch (e) {
      return err(e)
    }
  })
  // tasks:cancel (U4): abort the running/queued task; it flips to failed(cancelled).
  const cancelById = (id: string): void => {
    const controller = abortControllers.get(id)
    if (controller != null) {
      controller.abort()
      return
    }
    // Not currently running: mark failed(cancelled) directly so the UI state is consistent.
    // D3 (review): 'pending' is not a pipeline stage — the CHECK on
    // failed_stage rejects it, which used to leave a never-created task
    // permanently un-cancellable and un-deletable. Terminal-relevant stages
    // pass through; anything else (pending) stores a NULL failed_stage.
    const repo = new TaskRepository(ctx.db)
    const row = repo.get(id)
    if (row != null && row.state !== 'succeeded' && row.state !== 'failed') {
      const failedStage = PIPELINE_STAGES.includes(row.state as Stage) ? (row.state as Stage) : null
      repo.markFailed(id, failedStage, '任务已取消', 'cancelled')
      // 声明批7: 取消即清除签名直链交接（与 queue.ts 的 cancelTask 同一口径），
      // 免得一条仍有生命的 auth_key 因为「取消」这个终态留在库里。
      repo.clearFetchHandoff(id)
      sendProgress({ taskId: id, state: 'failed', stage: failedStage, message: '任务已取消', percent: 0, kind: 'cancelled' })
    }
  }
  handle(ipc, 'tasks:cancel', (_e, taskId: unknown) => {
    try {
      cancelById(assertSafeId(taskId, 'taskId'))
      return ok({ cancelled: true })
    } catch (e) {
      return err(e)
    }
  })

  // ---- notes ----
  handle(ipc, 'notes:latest', (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const row = ctx.db
        .prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1')
        .get(id) as { note_json: string } | undefined
      if (row == null) return ok(null)
      const note = parseNote(row.note_json) as Note
      // 批2 (plan 2026-09-20, P7): 转写摘引命中率只能在 main 侧算（渲染层没有
      // 转写）——带出去之后查看器徽标与 courseHealth（升级列表）走**同一个**
      // noteHealth 口径。无笔记时上面的 ok(null) 早退不动（smoke 探针依赖它）。
      return ok({ note, transcriptHitRate: transcriptHitRateFor(ctx.db, id, note) })
    } catch (e) {
      return err(e)
    }
  })

  // 批B: cross-lesson note library — lets the notes tab show every generated
  // note before any lesson is selected. Read-only, newest first.
  // 批C: 关键词过滤在主进程做（渲染层过滤只能过滤已取回的那 200 条——用户搜「某节课」
  // 搜不到而那条笔记其实存在，等于对数据撒谎）；关键词**只匹配列表里看得见的字段**
  // （课程名 / 教师 / 课时名）——搜「教室」却命中一条不显示教室的行会被当成 bug（plan D3）。
  handle(ipc, 'notes:list', (_e, rawQuery: unknown) => {
    try {
      const query = (rawQuery ?? {}) as { keyword?: unknown }
      const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
      const { limit, offset } = readPage(rawQuery, NOTE_LIST_LIMIT)
      const where = keyword === '' ? '' : 'WHERE (c.name LIKE @kw OR c.teacher LIKE @kw OR l.title LIKE @kw)'
      const filterParams = keyword === '' ? {} : { kw: `%${keyword}%` }
      // 总数与页用同一个 WHERE 子句（口径漂移过一次就再也对不上）。
      const total = (
        ctx.db
          .prepare(
            `SELECT COUNT(*) AS n FROM (
               SELECT n.lesson_id FROM notes n
               JOIN lessons l ON l.id = n.lesson_id
               LEFT JOIN courses c ON c.id = l.course_id
               ${where}
               GROUP BY n.lesson_id)`
          )
          .get(filterParams) as { n: number }
      ).n
      const rows = ctx.db
        .prepare(
          `SELECT n.lesson_id AS lessonId, MAX(n.version) AS version, MAX(n.created_at) AS createdAt,
                  l.title AS lessonTitle, c.id AS courseId, c.name AS courseName, c.teacher
           FROM notes n
           JOIN lessons l ON l.id = n.lesson_id
           LEFT JOIN courses c ON c.id = l.course_id
           ${where}
           GROUP BY n.lesson_id
           ORDER BY createdAt DESC
           LIMIT @limit OFFSET @offset`
        )
        .all({ ...filterParams, limit, offset }) as Array<{
        lessonId: string
        version: number
        createdAt: string
        lessonTitle: string | null
        courseId: string | null
        courseName: string | null
        teacher: string | null
      }>
      return ok({ items: rows, total, limit })
    } catch (e) {
      return err(e)
    }
  })
  // 质量批4 (plan 2026-09-08 note-quality-overhaul): per-lesson health for a
  // course — feeds the library's «升级旧笔记» picker. Latest version only;
  // corrupt note_json degrades to a weak report instead of failing the course.
  handle(ipc, 'notes:courseHealth', (_e, courseId: unknown) => {
    try {
      const id = assertSafeId(courseId, 'courseId')
      const course = ctx.db.prepare('SELECT id FROM courses WHERE id = ?').get(id)
      if (course == null) return err(new Error('课程不存在'))
      const rows = ctx.db
        .prepare(
          `SELECT l.id AS lessonId, l.title AS lessonTitle, n.version, n.note_json, n.prompt_version AS promptVersion
           FROM lessons l
           JOIN notes n ON n.lesson_id = l.id
           WHERE l.course_id = ? AND n.version = (SELECT MAX(version) FROM notes WHERE lesson_id = l.id)
           ORDER BY l.title`
        )
        .all(id) as Array<{ lessonId: string; lessonTitle: string; version: number; note_json: string; promptVersion: number }>
      const report = rows.map((row) => {
        try {
          const note = parseNote(row.note_json)
          const hitRate = evidenceHitRate(note, loadValidRefs(ctx.db, row.lessonId))
          // 批1: 转写摘引可核验率——渲染层没有转写，只能在这里算。
          const transcriptHitRate = transcriptHitRateFor(ctx.db, row.lessonId, note)
          // P31: 转写时间范围——体检「时间范围」指标（越界的存量旧笔记可见化）。
          const transcriptRange = transcriptRangeFor(ctx.db, row.lessonId)
          const health = noteHealth(note, hitRate, transcriptHitRate, null, transcriptRange)
          return {
            lessonId: row.lessonId,
            lessonTitle: row.lessonTitle,
            version: row.version,
            warnCount: health.warnCount,
            grade: health.grade,
            promptVersion: row.promptVersion
          }
        } catch (err) {
          // H27 (audit 2026-09-28): 坏 note_json 降级成 weak 报告是对的（不能让
          // 一门课的整体体检崩掉），但不能一声不吭——界面只显示「3 项待改进」，
          // 日志里必须有这一课时的降级记录与原因，否则「是笔记坏了还是归一层
          // 坏了」永远查不到。
          ctx.logger.warn(`courseHealth degraded lesson=${row.lessonId}: ${(err as Error).message}`)
          return {
            lessonId: row.lessonId,
            lessonTitle: row.lessonTitle,
            version: row.version,
            warnCount: 3,
            grade: 'weak' as const,
            promptVersion: row.promptVersion
          }
        }
      })
      return ok(report)
    } catch (e) {
      return err(e)
    }
  })
  // Obsidian 导出 (plan 2026-09-08-obsidian-export 批1/批2): file plumbing
  // lives in notes/obsidian-export.ts — vault resolution (setting > seam >
  // picker), idempotent per-lesson writes, derived pages on course export.
  handle(ipc, 'notes:exportObsidian', async (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      // Nothing to export → fail before the vault picker ever opens.
      const exists = ctx.db.prepare('SELECT 1 FROM notes WHERE lesson_id = ?').get(id)
      if (exists == null) return err(new Error('该课时尚无笔记'))
      const vaultResult = await resolveObsidianVault(ctx.db)
      if ('canceled' in vaultResult) return ok({ canceled: true })
      const result = exportLessonToObsidian(ctx.db, ctx.libraryRoot, id, vaultResult.vault)
      return ok({ canceled: false, path: result.path, version: result.version })
    } catch (e) {
      return err(e)
    }
  })

  handle(ipc, 'notes:exportCourseObsidian', async (_e, courseId: unknown) => {
    try {
      const id = assertSafeId(courseId, 'courseId')
      const course = ctx.db.prepare('SELECT id FROM courses WHERE id = ?').get(id)
      if (course == null) return err(new Error('课程不存在'))
      const vaultResult = await resolveObsidianVault(ctx.db)
      if ('canceled' in vaultResult) return ok({ canceled: true })
      const result = exportCourseToObsidian(ctx.db, ctx.libraryRoot, id, vaultResult.vault)
      // 批3 (P23): 每篇失败逐条落日志——toast 只放得下前两条原因，日志才是可复核的现场。
      // vault 路径两道折：reason 产生时已把绝对路径折成 `…\文件名`（obsidian-export.ts
      // 的 failureReason，因为 toast 不经过 redact），落盘再过 Logger 的 redact
      // （其绝对路径规则见 logger.ts 的 foldAbsolutePaths）。
      for (const failure of result.failures) {
        ctx.logger.warn(`obsidian course export failed: course=${id} lesson=${failure.lessonId} reason=${failure.reason}`)
      }
      return ok({ canceled: false, ...result })
    } catch (e) {
      return err(e)
    }
  })

  // Export the latest note as Markdown via the system save dialog (U3).
  handle(ipc, 'notes:exportMarkdown', async (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const row = ctx.db
        .prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1')
        .get(id) as { note_json: string } | undefined
      if (row == null) throw new Error('该课时尚无笔记')
      const lesson = ctx.db
        .prepare(
          `SELECT l.title, c.name AS course_name, c.teacher
           FROM lessons l LEFT JOIN courses c ON c.id = l.course_id WHERE l.id = ?`
        )
        .get(id) as { title: string; course_name: string | null; teacher: string | null } | undefined
      // 批D: the file name (and the in-file title) carry the full identity.
      const fullName = noteExportBaseName({
        courseName: lesson?.course_name,
        teacher: lesson?.teacher,
        lessonTitle: lesson?.title,
        lessonId: id
      })
      const md = noteToMarkdown(parseNote(row.note_json), fullName)
      const win = BrowserWindow.getFocusedWindow()
      const options: SaveDialogOptions = {
        title: '导出笔记为 Markdown',
        defaultPath: join(ctx.exportsDir(), `${fullName}.md`),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      }
      const { canceled, filePath } = win == null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options)
      if (canceled || filePath == null) return ok({ canceled: true })
      writeFileSync(filePath, md, 'utf8')
      return ok({ canceled: false, path: filePath })
    } catch (e) {
      return err(e)
    }
  })

  // 2026-09-04 roadmap 2.2: export Anki TSV decks (concept cards + quiz) via
  // the save dialog; the first deck lands on the chosen path, additional
  // decks sit beside it with derived names. SEU_ANKI_PATH bypasses the
  // native dialog (e2e seam, same pattern as SEU_PDF_PATH; 打包后不生效，
  // 见 devExportOverridePath).
  handle(ipc, 'notes:exportAnki', async (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const row = ctx.db
        .prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1')
        .get(id) as { note_json: string } | undefined
      if (row == null) throw new Error('该课时尚无笔记')
      const lesson = ctx.db
        .prepare(
          `SELECT l.title, c.name AS course_name, c.teacher
           FROM lessons l LEFT JOIN courses c ON c.id = l.course_id WHERE l.id = ?`
        )
        .get(id) as { title: string; course_name: string | null; teacher: string | null } | undefined
      const title = lesson?.title ?? id
      // 批D: deck files share the full course-teacher-lesson base name.
      const baseName = noteExportBaseName({
        courseName: lesson?.course_name,
        teacher: lesson?.teacher,
        lessonTitle: lesson?.title,
        lessonId: id
      })
      const decks = ankiDecks(parseNote(row.note_json), title)
      if (decks.length === 0) throw new Error('本笔记没有概念卡或自测题可导出')
      const overridePath = devExportOverridePath('SEU_ANKI_PATH')
      let firstPath: string
      if (overridePath != null && overridePath !== '') {
        firstPath = overridePath
      } else {
        const win = BrowserWindow.getFocusedWindow()
        const options: SaveDialogOptions = {
          title: '导出 Anki 概念卡（其余牌堆写至同目录）',
          defaultPath: join(ctx.exportsDir(), `${baseName}-${decks[0]!.name}.txt`),
          filters: [{ name: 'Anki TSV', extensions: ['txt'] }]
        }
        const { canceled, filePath } = win == null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options)
        if (canceled || filePath == null) return ok({ canceled: true, paths: [] })
        firstPath = filePath
      }
      const written: string[] = []
      decks.forEach((deck, index) => {
        const target = index === 0 ? firstPath : join(dirname(firstPath), `${baseName}-${deck.name}.txt`)
        writeFileSync(target, deckToTsv(deck), 'utf8')
        written.push(target)
      })
      return ok({ canceled: false, paths: written })
    } catch (e) {
      return err(e)
    }
  })

  // 批5 (plan 2026-09-17 note-quality-upgrade item 3): export the knowledge tree
  // as a bitmap. 光栅化在**渲染层**做（canvas 只能在那里用），渲染层调
  // `treeToSvgDocument` 自己产 SVG 再画到 canvas，这里只负责写字节。
  // 这样 SVG 文本不必经 IPC 往返，主进程也不需要解码器（零新依赖）。
  // 入参是 PNG 的 base64：main 侧**校验魔数**后才落盘——渲染层是可信的，
  // 但「渲染层传来的字节直接写盘」这种面不该无条件打开。
  handle(ipc, 'notes:exportPng', async (_e, lessonId: unknown, base64: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const data = str(base64, 'png')
      const bytes = Buffer.from(data, 'base64')
      if (bytes.length < 8 || bytes.subarray(0, 8).compare(PNG_SIGNATURE) !== 0) {
        throw new Error('导出失败：收到的数据不是 PNG')
      }
      const lesson = ctx.db
        .prepare(
          `SELECT l.title, c.name AS course_name, c.teacher
           FROM lessons l LEFT JOIN courses c ON c.id = l.course_id WHERE l.id = ?`
        )
        .get(id) as { title: string; course_name: string | null; teacher: string | null } | undefined
      const fullName = noteExportBaseName({
        courseName: lesson?.course_name,
        teacher: lesson?.teacher,
        lessonTitle: lesson?.title,
        lessonId: id
      })
      const overridePath = devExportOverridePath('SEU_PNG_PATH')
      if (overridePath != null) {
        writeFileSync(overridePath, bytes)
        return ok({ canceled: false, path: overridePath })
      }
      const win = BrowserWindow.getFocusedWindow()
      const options: SaveDialogOptions = {
        title: '导出思维导图为 PNG',
        defaultPath: join(ctx.exportsDir(), `${fullName}.png`),
        filters: [{ name: 'PNG', extensions: ['png'] }]
      }
      const { canceled, filePath } = win == null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options)
      if (canceled || filePath == null) return ok({ canceled: true })
      writeFileSync(filePath, bytes)
      return ok({ canceled: false, path: filePath })
    } catch (e) {
      return err(e)
    }
  })

  // M3.3 (map expansion 2026-09-05): export the knowledge tree as a
  // standalone paper-white SVG via the save dialog. SEU_SVG_PATH bypasses
  // the native dialog (e2e seam, same pattern as SEU_PDF_PATH/SEU_ANKI_PATH;
  // 打包后不生效，见 devExportOverridePath).
  handle(ipc, 'notes:exportSvg', async (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const row = ctx.db
        .prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1')
        .get(id) as { note_json: string } | undefined
      if (row == null) throw new Error('该课时尚无笔记')
      const lesson = ctx.db
        .prepare(
          `SELECT l.title, c.name AS course_name, c.teacher
           FROM lessons l LEFT JOIN courses c ON c.id = l.course_id WHERE l.id = ?`
        )
        .get(id) as { title: string; course_name: string | null; teacher: string | null } | undefined
      const fullName = noteExportBaseName({
        courseName: lesson?.course_name,
        teacher: lesson?.teacher,
        lessonTitle: lesson?.title,
        lessonId: id
      })
      const note = parseNote(row.note_json)
      const svg = treeToSvg(note.knowledgeTree, note.conceptLinks, fullName)
      const overridePath = devExportOverridePath('SEU_SVG_PATH')
      if (overridePath != null) {
        writeFileSync(overridePath, svg, 'utf8')
        return ok({ canceled: false, path: overridePath })
      }
      const win = BrowserWindow.getFocusedWindow()
      const options: SaveDialogOptions = {
        title: '导出思维导图为 SVG',
        defaultPath: join(ctx.exportsDir(), `${fullName}.svg`),
        filters: [{ name: 'SVG', extensions: ['svg'] }]
      }
      const { canceled, filePath } = win == null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options)
      if (canceled || filePath == null) return ok({ canceled: true })
      writeFileSync(filePath, svg, 'utf8')
      return ok({ canceled: false, path: filePath })
    } catch (e) {
      return err(e)
    }
  })

  // M4.1 (map expansion 2026-09-05): course-level mind map — aggregate every
  // lesson's latest knowledgeTree into one tree (pure merge, zero new model
  // calls). A corrupt note JSON skips that lesson instead of failing the map.
  handle(ipc, 'notes:courseTree', (_e, courseId: unknown) => {
    try {
      const id = assertSafeId(courseId, 'courseId')
      const course = ctx.db.prepare('SELECT name FROM courses WHERE id = ?').get(id) as { name: string } | undefined
      if (course == null) throw new Error('课程不存在')
      const rows = ctx.db
        .prepare(
          `SELECT l.title AS lessonTitle, n.note_json
           FROM lessons l
           JOIN notes n ON n.lesson_id = l.id
             AND n.version = (SELECT MAX(version) FROM notes WHERE lesson_id = l.id)
           WHERE l.course_id = ?`
        )
        .all(id) as Array<{ lessonTitle: string; note_json: string }>
      const entries: Array<{ lessonTitle: string; tree: Note['knowledgeTree'] }> = []
      let skipped = 0
      for (const row of rows) {
        try {
          entries.push({ lessonTitle: row.lessonTitle, tree: parseNote(row.note_json).knowledgeTree })
        } catch {
          skipped += 1
        }
      }
      return ok({ tree: mergeCourseTree(course.name, entries), lessons: entries.length, skipped })
    } catch (e) {
      return err(e)
    }
  })

  // 2026-09-04: attachments (keyframes + PPT pages) as data URLs for the note views.
  handle(ipc, 'notes:attachments', (_e, lessonId: unknown) => {
    try {
      // F4 (review): the manifest is identity-only — data URLs stream in
      // per ref via notes:attachmentData instead of one giant IPC message.
      return ok(listAttachmentManifest(ctx.db, assertSafeId(lessonId, 'lessonId')))
    } catch (e) {
      return err(e)
    }
  })

  // F4 (review): one attachment's bytes per call — renderer caches per ref.
  handle(ipc, 'notes:attachmentData', (_e, lessonId: unknown, ref: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const attachmentRef = str(ref, 'ref')
      return ok(readAttachmentData(ctx.db, id, attachmentRef, ctx.libraryRoot))
    } catch (e) {
      return err(e)
    }
  })

  // 批 A2 (plan 2026-09-19): 课时封面（B 站导入落盘的 cover.jpg）。没有封面返回
  // ok(null) 而不是错误——SEU 源与未导入封面的课时都是合法无封面态。
  handle(ipc, 'notes:cover', (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      return ok(readLessonCover(ctx.db, id, ctx.libraryRoot))
    } catch (e) {
      return err(e)
    }
  })

  // 批3 (plan 2026-09-20, P1/D8): 封面回填。导入时封面只抓一次（失败即静默放弃），
  // migration 012 之前导入的 B 站课时更是永远没有封面——这里从库内的 bvid 重走
  // viewInfo → pic → data URL → 落盘 → 写回 cover_path。零新依赖（复用现有 B 站
  // 客户端与 saveLessonCover）。红线同 lessons:openSource：只接受 lessonId，
  // 请求用的 BV 号从库里取并再过一次形态校验（库内值被改坏也不外发）。
  handle(ipc, 'notes:backfillCover', async (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const row = ctx.db
        .prepare('SELECT l.source AS source, l.bili_page AS page, c.bili_bvid AS bvid FROM lessons l LEFT JOIN courses c ON c.id = l.course_id WHERE l.id = ?')
        .get(id) as { source: string; page: number | null; bvid: string | null } | undefined
      if (row == null) return err(new Error('课时不存在'))
      if (row.source !== 'bilibili' || row.bvid == null || !isValidBilibiliBvid(row.bvid)) {
        return err(new Error('只有 B 站导入的课时能补取封面'))
      }
      // 批3 (P1 评审补口): 这一步是最可能失败的一步（方案 §5 点名的风控风险：每次点击
      // 打一次 B 站 view 接口），而 client 抛的是英文技术串（如
      // `bilibili risk control (HTTP 412) for api.bilibili.com/x/web-interface/view`）。
      // 渲染层把 res.error 原样 toast，所以这里必须翻成人话——风控/未登录/找不到/
      // 网络各有各的下一步。
      let view: Awaited<ReturnType<typeof ctx.bilibili.viewInfo>>
      try {
        view = await ctx.bilibili.viewInfo(row.bvid)
      } catch (error) {
        return err(new Error(coverViewErrorMessage(error)))
      }
      if (view.coverUrl === '') return err(new Error('该视频没有可用封面'))
      const coverDataUrl = await ctx.bilibili.fetchImageAsDataUrl(view.coverUrl)
      if (coverDataUrl == null) return err(new Error('封面下载失败，请稍后重试'))
      const coverPath = saveLessonCover(ctx.libraryRoot, id, coverDataUrl)
      if (coverPath == null) return err(new Error('封面落盘失败，请检查资料库目录是否可写'))
      // 只在真的拿到新封面之后才动库里的列——失败路径不碰既有 cover_path。
      ctx.db.prepare('UPDATE lessons SET cover_path = ? WHERE id = ?').run(coverPath, id)
      ctx.logger.info(`lesson cover backfilled: lesson=${id} bvid=${row.bvid}`)
      return ok({ coverPath })
    } catch (e) {
      return err(e)
    }
  })

  // 批 D (plan 2026-09-19): B 站原片时间戳跳转。渲染层只传 lessonId + 秒数；
  // URL 由 main 侧拼（常量基准 + 库内 bvid，过 BV 正则）——红线：不接受渲染层传入的 URL。
  // SEU 源如实拒绝：平台播放页没有时间参数，2026-09-19 前「不做」的边界按源收窄。
  handle(ipc, 'lessons:openSource', async (_e, lessonId: unknown, at: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const row = ctx.db
        .prepare('SELECT l.source AS source, l.bili_page AS page, c.bili_bvid AS bvid FROM lessons l LEFT JOIN courses c ON c.id = l.course_id WHERE l.id = ?')
        .get(id) as { source: string; page: number | null; bvid: string | null } | undefined
      if (row == null) return err(new Error('课时不存在'))
      if (row.source !== 'bilibili') return err(new Error('SEU 来源的课时没有可跳转的原片页面'))
      if (row.bvid == null) return err(new Error('这节课没有关联的 B 站视频'))
      const url = buildBilibiliSourceUrl(row.bvid, at, row.page)
      if (url == null) return err(new Error('库内 BV 号不合法，拒绝跳转'))
      await shell.openExternal(url)
      return ok(true as const)
    } catch (e) {
      return err(e)
    }
  })

  // 2026-09-04: regenerate the note from stored transcripts/keyframes — no
  // re-download. Guarded: refuses while a task for this lesson is queued/running.
  handle(ipc, 'notes:regenerate', async (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      // Input checks first: a missing transcript should not masquerade as a
      // provider-binding problem (chatFor throws when unbound).
      const inputs = loadSummarizeInputs(ctx.db, id, ctx.libraryRoot)
      if ('error' in inputs) return err(new Error(inputs.error))
      if (queue.current() != null) return err(new Error('任务运行中，请等待完成后再重新生成笔记'))
      const runningForLesson = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE lesson_id = ? AND state IN ('pending','summarizing','transcribing','extracting_visuals','extracting_audio','downloading_video','fetching_course')")
        .get(id) as { n: number }
      if (runningForLesson.n > 0) return err(new Error('该课时存在排队/运行中的任务，请等待完成后再重新生成笔记'))
      // 批5: 与 polish 共用进程内在途登记——同课时同时只允许一路笔记重写，
      // 否则两路各算出同一个 MAX(version)+1，INSERT 撞 UNIQUE 撞在用户面前。
      if (!claimNoteInflight(id, 'regenerate')) return err(new Error('该课时已有笔记生成或润色在进行中，请稍候'))
      try {
        const client = ctx.chatFor('multimodal')
        const result = await summarizeLesson(ctx.db, client, id, ctx.libraryRoot)
        if ('error' in result) return err(new Error(result.error))
        // H27: 生成前读不出来的图——模型少看了画面，结果里带了 droppedImages
        // 计数，日志侧同步一条 warn（否则界面只显示「发了 N 张」这个更小的数）。
        if (result.droppedImages > 0) {
          ctx.logger.warn(`notes:regenerate lesson=${id} read failed for ${result.droppedImages} image(s)`)
        }
        return ok(result)
      } finally {
        releaseNoteInflight(id)
      }
    } catch (e) {
      return err(e)
    }
  })

  // 批2 (plan 2026-09-20, P2): 定向补全——对**已存盘**的最新版笔记按体检问题修一次。
  // 与 regenerate 的差别是它存在的理由：不发图片（只带转写，多模态费用不翻倍）、
  // 只跑一次、warn 数没下降就保留原稿不存新版本（判据与生成路径同一口径，见
  // repairStoredNote）。守卫与 regenerate 同款：转写缺失 → 队列占用 → 该课时有在跑
  // 任务 → 在途登记（与 regenerate/polish 共用，防 version 撞 UNIQUE）。
  handle(ipc, 'notes:repair', async (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      // 输入检查先行（与 regenerate 同序）：转写缺失不该伪装成「未绑模型」。
      if (loadCleanSegments(ctx.db, id) == null) return err(new Error('转写结果缺失，请先运行完整任务生成转写'))
      if (queue.current() != null) return err(new Error('任务运行中，请等待完成后再补全笔记'))
      const runningForLesson = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE lesson_id = ? AND state IN ('pending','summarizing','transcribing','extracting_visuals','extracting_audio','downloading_video','fetching_course')")
        .get(id) as { n: number }
      if (runningForLesson.n > 0) return err(new Error('该课时存在排队/运行中的任务，请等待完成后再补全笔记'))
      // 绑定检查放在 chatFor 之前：chatFor 抛的是「能力 multimodal 未绑定 Provider」，
      // 而用户需要的是可执行的下一步（与 summarizeLesson 内返修同源的那句话）。
      const binding = ctx.db.prepare("SELECT model FROM capability_bindings WHERE capability = 'multimodal'").get()
      if (binding == null) return err(new Error('未绑定多模态模型，请在设置中配置'))
      if (!claimNoteInflight(id, 'repair')) return err(new Error('该课时已有笔记生成或润色在进行中，请稍候'))
      try {
        const client = ctx.chatFor('multimodal')
        const result = await repairStoredNote(ctx.db, client, id)
        if ('error' in result) return err(new Error(result.error))
        return ok(result)
      } finally {
        releaseNoteInflight(id)
      }
    } catch (e) {
      return err(e)
    }
  })

  // 批5 (plan 2026-09-07 v07): feedback-driven polish — revise the latest note
  // per user feedback, persisting it as version N+1. No images, no queue slot
  // (qa:ask precedent); regenerate's two guards apply, plus the shared
  // notes/inflight registry so polish × regenerate cannot race two INSERTs
  // at the same version.
  /** Tag count cap (FEEDBACK_TAGS is the vocabulary; unknown ids are dropped downstream). */
  const FEEDBACK_TAG_LIMIT = FEEDBACK_TAGS.length
  /** Free-text cap — polish.ts clamps again before prompting (defense in depth). */
  const MAX_FEEDBACK_TEXT = 2_000
  /** Validate the renderer's feedback payload — tags must be strings, text is clamped. */
  const parseFeedback = (raw: unknown): { tags: string[]; text: string } | null => {
    if (typeof raw !== 'object' || raw == null) return null
    const candidate = raw as { tags?: unknown; text?: unknown }
    const tags = Array.isArray(candidate.tags) ? candidate.tags.filter((t): t is string => typeof t === 'string' && t !== '').slice(0, FEEDBACK_TAG_LIMIT) : []
    const text = typeof candidate.text === 'string' ? candidate.text.trim().slice(0, MAX_FEEDBACK_TEXT) : ''
    return tags.length === 0 && text === '' ? null : { tags, text }
  }
  handle(ipc, 'notes:polish', async (_e, lessonId: unknown, feedback: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const parsed = parseFeedback(feedback)
      if (parsed == null) return err(new Error('请先选择至少一个问题或填写补充说明'))
      if (queue.current() != null) return err(new Error('任务运行中，请等待完成后再润色笔记'))
      const runningForLesson = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE lesson_id = ? AND state IN ('pending','summarizing','transcribing','extracting_visuals','extracting_audio','downloading_video','fetching_course')")
        .get(id) as { n: number }
      if (runningForLesson.n > 0) return err(new Error('该课时存在排队/运行中的任务，请等待完成后再润色笔记'))
      if (!claimNoteInflight(id, 'polish')) return err(new Error('该课时已有笔记生成或润色在进行中，请稍候'))
      try {
        const client = ctx.chatFor('multimodal')
        // 批3: 传 libraryRoot —— 润色要补发少量关键帧（它 prompt 里本来就承诺
        // 「转写同音错词结合画面纠正」，而代码此前从不发图）。
        const result = await polishNote(ctx.db, client, id, parsed, ctx.libraryRoot)
        if ('error' in result) return err(new Error(result.error))
        return ok(result)
      } finally {
        releaseNoteInflight(id)
      }
    } catch (e) {
      return err(e)
    }
  })

  // 2026-09-04: PDF handout export — step 1, pick the target file.
  // SEU_PDF_PATH bypasses the native dialog (e2e/test seam; 仅开发期生效——
  // app.isPackaged 为 true 时无视该变量，见 devExportOverridePath)。
  handle(ipc, 'notes:exportPdfDialog', async (_e, lessonId: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      // 批5: 发起新导出前先清扫过期 token——被放弃的导出会话否则会一直
      // 躺在 map 里（过期检查此前只在写入时发生）。
      for (const [token, pending] of pendingPdfExports) {
        if (Date.now() > pending.expiresAt) pendingPdfExports.delete(token)
      }
      const lesson = ctx.db
        .prepare(
          `SELECT l.title, c.name AS course_name, c.teacher
           FROM lessons l LEFT JOIN courses c ON c.id = l.course_id WHERE l.id = ?`
        )
        .get(id) as { title: string; course_name: string | null; teacher: string | null } | undefined
      // 批D: full course-teacher-lesson base name for the handout file.
      const baseName = noteExportBaseName({
        courseName: lesson?.course_name,
        teacher: lesson?.teacher,
        lessonTitle: lesson?.title,
        lessonId: id
      })
      const overridePath = devExportOverridePath('SEU_PDF_PATH')
      if (overridePath != null) {
        const token = randomUUID()
        pendingPdfExports.set(token, { filePath: overridePath, expiresAt: Date.now() + 5 * 60 * 1000 })
        return ok({ canceled: false, path: overridePath, token })
      }
      const win = BrowserWindow.getFocusedWindow()
      const options: SaveDialogOptions = {
        title: '导出笔记为 PDF 讲义',
        defaultPath: join(ctx.exportsDir(), `${baseName}-讲义.pdf`),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      }
      const { canceled, filePath } = win == null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(win, options)
      if (canceled || filePath == null) return ok({ canceled: true })
      const token = randomUUID()
      pendingPdfExports.set(token, { filePath, expiresAt: Date.now() + 5 * 60 * 1000 })
      return ok({ canceled: false, path: filePath, token })
    } catch (e) {
      return err(e)
    }
  })

  // 2026-09-04: PDF handout export — step 2, print the main window (renderer
  // has already rendered the handout into #print-root) and write the file.
  handle(ipc, 'notes:exportPdfWrite', async (_e, token: unknown) => {
    try {
      // E3 (review): the write path comes from main's own dialog record,
      // one-shot and expiring — never from the renderer.
      const tokenValue = str(token, 'token')
      const pending = pendingPdfExports.get(tokenValue)
      if (pending == null) throw new Error('导出会话无效或已过期，请重新导出')
      pendingPdfExports.delete(tokenValue)
      if (Date.now() > pending.expiresAt) throw new Error('导出会话已过期，请重新导出')
      const win = BrowserWindow.getFocusedWindow()
      if (win == null) throw new Error('主窗口不可用，无法生成 PDF')
      const bytes = await printToPdfFile(win.webContents, pending.filePath)
      return ok({ path: pending.filePath, bytes })
    } catch (e) {
      return err(e)
    }
  })

  // 2026-09-04: reveal an exported file in Explorer (toast action after export).
  handle(ipc, 'notes:revealFile', (_e, filePath: unknown) => {
    try {
      // E4 (review): reveal only files the app itself produced — outside
      // the exports/attachments/obsidian-vault roots the request is refused.
      const requested = str(filePath, 'filePath')
      const allowedRoots = [ctx.exportsDir(), attachmentsPath(ctx.libraryRoot)]
      const vault = getSetting(ctx.db, 'obsidianVaultPath', '')
      if (vault !== '') allowedRoots.push(vault)
      // 批6: 备份落点由用户自选（可能在导出目录外）——main 刚写下的备份路径
      // 放行（一次性），「打开所在文件夹」对自选路径不失灵。
      const backupReveal = recentLibraryBackups.has(requested)
      const allowed = backupReveal || allowedRoots.some((root) => {
        const resolved = resolve(requested)
        return resolved === root || resolved.startsWith(root + sep)
      })
      if (!allowed) throw new Error('只能打开导出目录或附件目录中的文件')
      shell.showItemInFolder(requested)
      // 终审修复波: reveal 成功后才消费这一次性放行——先 delete 后 reveal
      // 的话，reveal 失败的重试会落到「只能打开导出目录或附件目录中的文件」
      // 的误导文案上（备份路径本就可能在导出目录外）。
      if (backupReveal) recentLibraryBackups.delete(requested)
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // ---- Q&A ----
  handle(ipc, 'qa:ask', async (_e, lessonId: unknown, question: unknown) => {
    try {
      const id = assertSafeId(lessonId, 'lessonId')
      const q = str(question, 'question')
      const noteRow = ctx.db
        .prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1')
        .get(id) as { note_json: string } | undefined
      // P37 (plan 2026-09-21): 追问以「该课时已有笔记」为硬门禁——放在绑定检查
      // 之前（没有笔记时不该先问模型绑定；与 notes:repair 的先例同序）。原实现
      // 无笔记也放行：基于转写回答，连转写都没有时甚至允许「不依赖课时材料的一般性
      // 问题」；用户明确「这没有必要，不如直接去问网页 AI」，只保留针对笔记的追问。
      if (noteRow == null) throw new Error('该课时尚无笔记，请先为此课时生成笔记后再追问')
      const note = parseNote(noteRow.note_json)
      const qaCtx = assembleContext(ctx.db, id, note)
      const messages = buildQaMessages(qaCtx, q)
      const capability = ctx.qaCapability()
      // 绑定检查放在 chatFor 之前：chatFor 抛的是「能力 multimodal 未绑定 Provider」，
      // 而用户需要的是可执行的下一步（与 notes:repair 的先例同款）。顺序在这里是
      // 可核对的判据——binding 为空时 chatFor 必先抛，放在它后面这句就到不了用户眼前。
      const binding = ctx.providers().bindings.find((b) => b.capability === capability)
      if (binding == null) throw new Error('未绑定问答模型，请在设置中配置多模态总结模型')
      const client = ctx.chatFor(capability)
      const answer = await client.chat(messages, binding.model)
      const qaId = recordQa(ctx.db, id, q, answer)
      return ok({ id: qaId, answer })
    } catch (e) {
      return err(e)
    }
  })
  handle(ipc, 'qa:history', (_e, lessonId: unknown) => {
    try {
      const rows = ctx.db
        .prepare('SELECT question, answer, created_at FROM qa WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(assertSafeId(lessonId, 'lessonId')) as Array<{ question: string; answer: string; created_at: string }>
      return ok(rows)
    } catch (e) {
      return err(e)
    }
  })

  // 批B: recent Q&A across lessons — the qa tab empty state so previous
  // exchanges (and their lessons) are reachable without picking a course.
  handle(ipc, 'qa:recent', () => {
    try {
      const rows = ctx.db
        .prepare(
          `SELECT q.lesson_id AS lessonId, q.question, q.answer, q.created_at AS createdAt,
                  l.title AS lessonTitle, c.name AS courseName
           FROM qa q
           JOIN lessons l ON l.id = q.lesson_id
           LEFT JOIN courses c ON c.id = l.course_id
           ORDER BY q.created_at DESC
           LIMIT 50`
        )
        .all() as Array<{
        lessonId: string
        question: string
        answer: string
        createdAt: string
        lessonTitle: string | null
        courseName: string | null
      }>
      return ok(rows)
    } catch (e) {
      return err(e)
    }
  })

  // M1-3: window-close confirm needs the queue state from main.
  // D5 (review): both guards cover the WHOLE queue (running + queued); D4's
  // tray listens for the drain to restore the window.
  return {
    isTaskRunning: () => queue.members().length > 0,
    cancelRunning: () => {
      for (const id of queue.members()) cancelById(id)
    },
    onQueueIdle: (cb: () => void): (() => void) => {
      idleListeners.add(cb)
      return () => {
        idleListeners.delete(cb)
      }
    }
  }
}

/** Convenience: a ProgressSender backed by real WebContents (auto no-op when the window is gone). */
export function webContentsSender(win: { webContents: WebContents } | null): ProgressSender | undefined {
  if (win == null) return undefined
  return {
    send: (channel, payload) => {
      if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
}

/**
 * 2026-09-30: 更新检查通道（plan 2026-09-30-public-release-autoupdate）。
 * controller 由 registerIpc 的 options.updateController 传入（index.ts 用真实
 * electron-updater 装配，tests/ipc-update 给假的）。缺省时三个 invoke 如实
 * 回答 unsupported——通道永远存在，行为取决于构建，不抛「通道不存在」。
 */
export function registerUpdateHandlers(ipc: HandleLike, controller: UpdateController | undefined, sender?: ProgressSender): void {
  handle(ipc, 'update:check', async () => {
    if (controller == null) return ok({ status: 'unsupported', message: '当前构建不支持检查更新' })
    return ok(await controller.check())
  })
  handle(ipc, 'update:download', async () => {
    if (controller == null) return ok({ started: false })
    return ok(await controller.download())
  })
  handle(ipc, 'update:install', async () => {
    if (controller == null) return ok({ installed: false })
    return ok(await controller.install())
  })
  // 事件（下载进度 / 下载完成 / 失败）经同一 sender 推到渲染层；没有 controller
  // 或没有窗口时订阅根本不建立——不留存一个永远触发不了的回调。
  if (controller != null && sender != null) {
    controller.subscribe((event) => sender.send('update:event', event))
  }
}
