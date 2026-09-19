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
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join, dirname, sep, resolve } from 'path'
import type { AppContext } from './app-context'
import type { Db } from './db/open'
import { isFakeIpResolution } from './net-diagnostics'
import { TaskRepository, runTask, type TaskProgress } from './tasks/queue'
import { SerialTaskQueue } from './tasks/serial-queue'
import { createExecutors } from './tasks/orchestrator'
import { resolveResumeStage, type ResumeDecision } from './tasks/resume'
import { PIPELINE_STAGES, stagePercent, type Stage } from './tasks/stages'
import type { StageExecutor } from './tasks/queue'
import { assembleContext, buildQaMessages, recordQa } from './notes/qa'
import { listAttachmentManifest, readAttachmentData } from './notes/attachments'
import { summarizeLesson, loadSummarizeInputs, transcriptHitRateFor } from './notes/summarize'
import { polishNote, loadValidRefs } from './notes/polish'
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
import { buildDiagnostics, type DiagnosticsTask } from './feedback/diagnostics'
import { redact } from './logger'
import { claimNoteInflight, releaseNoteInflight } from './notes/inflight'
import type { Note } from '../shared/notes/schema'

/** 批5: PNG 魔数——渲染层传来的位图必须真的是 PNG 才落盘。 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 批C (plan 2026-09-18 note-library-reachability): 列表分页。
 * 默认值与整改前一致（笔记 200 / 任务 50），改的是「能不能如实说话」——
 * 返回里带上 total，UI 才知道自己被截断了；要更多走 offset 分页，而不是把上限调大。
 */
const NOTE_LIST_LIMIT = 200
const TASK_LIST_LIMIT = 50
/** 硬帽子：渲染层传什么都不会一次拉爆（分页才是正路）。 */
const LIST_LIMIT_MAX = 500
import { resolveCacheDir, attachmentsPath } from './library/paths'
import { migrateLibrary } from './library/migrate'
import { writeLibraryPointer } from './library/pointer'
import { getSetting, SETTINGS_KEYS } from './settings/store'
import { fetchBilibiliLesson } from './bilibili/pipeline'
import { nextPendingChainTask } from './bilibili/chain'
import { biliCourseId, biliLessonId, parseBiliInput } from './bilibili/url-parse'

/** User-tunable page cap (settings key courseListMaxPages); undefined → client default. */
function maxPagesFrom(db: Db): number | undefined {
  const parsed = Number(getSetting(db, 'courseListMaxPages', ''))
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined
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
 * 批2 (audit 2026-09-19): id 字符校验——凡拼进文件路径或当 DB 行键的入参都先过
 * 这里。纪律沿用 tasks:delete 的既有 inline 校验：首字符必须字母数字，«.» «..»
 * «../x» 因此无法解析到别的目录（join(root, '.') 就是 root 本身）；再补长度上限
 * 防超长键。中文等非 ASCII id 一并拒绝（手动课程 id 请用英文/数字）。
 */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export function assertSafeId(v: unknown, name: string): string {
  const id = str(v, name)
  if (!SAFE_ID_RE.test(id)) throw new Error(`${name} 格式不合法`)
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
  // Serial task executor + cancellation registry (U4): one task at a time,
  // cancellable via AbortController keyed by task id.
  const queue = new SerialTaskQueue()
  const abortControllers = new Map<string, AbortController>()
  // D1: queue cap, mirroring the renderer's B1 guard (main is the authority).
  const MAX_QUEUED_TASKS = 3
  // D1: ids cancelled (or otherwise killed) while waiting in the queue —
  // the dequeue recheck must skip THESE, but not a legitimate failed-task
  // retry whose row is also 'failed' at dequeue time.
  const cancelledWhileQueued = new Set<string>()
  // D4: notified when the queue drains (tray restores the window).
  const idleListeners = new Set<() => void>()

  // E3 (review): PDF export step 1 (dialog) hands out a one-shot token;
  // step 2 (write) only honors a live token — the renderer can no longer
  // ask printToPDF to write ANY path it names.
  const pendingPdfExports = new Map<string, { filePath: string; expiresAt: number }>()
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
  handle(ipc, 'bilibili:logout', () => {
    ctx.bilibiliLogout()
    return ok({ state: ctx.bilibiliSessionState() })
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
      ctx.logger.info(`bilibili import: ${courseId} pages=${lessonIds.length}`)
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
      ctx.db.transaction(() => {
        const upsert = ctx.db.prepare(
          `INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, play_ref = excluded.play_ref, fetched_at = excluded.fetched_at`
        )
        for (const entry of harvest.lessons) {
          upsert.run(`${cid}-L${entry.index}`, cid, entry.title, entry.ref, now)
        }
        // The platform list shifts as lessons are added: drop previously
        // harvested rows that this harvest no longer covers (an empty
        // harvest keeps everything — likely a page-change anomaly).
        if (keepIds.length > 0) {
          ctx.db
            .prepare(
              `DELETE FROM lessons WHERE course_id = ? AND id LIKE ? AND id NOT IN (${keepIds.map(() => '?').join(',')})`
            )
            .run(cid, `${cid}-L%`, ...keepIds)
        }
      })()
      ctx.logger.info(`harvestLessons: course=${cid} entries=${harvest.lessons.length}`)
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
  handle(ipc, 'school:removeCourse', (_e, courseId: unknown) => {
    try {
      const cid = assertSafeId(courseId, 'courseId')
      const noteRow = ctx.db
        .prepare('SELECT COUNT(*) AS n FROM notes n JOIN lessons l ON n.lesson_id = l.id WHERE l.course_id = ?')
        .get(cid) as { n: number }
      const taskRow = ctx.db
        .prepare('SELECT COUNT(*) AS n FROM tasks t JOIN lessons l ON t.lesson_id = l.id WHERE l.course_id = ?')
        .get(cid) as { n: number }
      if (noteRow.n > 0 || taskRow.n > 0) {
        throw new Error('该课程已有笔记或任务记录，为保护数据不允许删除')
      }
      ctx.db.transaction(() => {
        ctx.db.prepare('DELETE FROM lessons WHERE course_id = ?').run(cid)
        ctx.db.prepare('DELETE FROM courses WHERE id = ?').run(cid)
      })()
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
      const cap = str(capability, 'capability')
      if (cap !== 'asr' && cap !== 'multimodal' && cap !== 'text') throw new Error('unknown capability')
      ctx.bind(cap, str(providerId, 'providerId'), str(model, 'model'))
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
      return ok({ text: redact(text) })
    } catch (e) {
      return err(e)
    }
  })

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
        // D1: out-of-dequeue recheck — a task cancelled while queued
        // must not run. A row that was already failed at ENQUEUE time is
        // a legitimate retry and proceeds (its state is also 'failed').
        if (cancelledWhileQueued.delete(id)) {
          return 'failed' as const
        }
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
      if (queue.members().includes(id)) cancelledWhileQueued.add(id)
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
      return ok(parseNote(row.note_json) as Note)
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
          const health = noteHealth(note, hitRate, transcriptHitRate)
          return {
            lessonId: row.lessonId,
            lessonTitle: row.lessonTitle,
            version: row.version,
            warnCount: health.warnCount,
            grade: health.grade,
            promptVersion: row.promptVersion
          }
        } catch {
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
  // native dialog (e2e seam, same pattern as SEU_PDF_PATH).
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
      const overridePath = process.env.SEU_ANKI_PATH
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
      const overridePath = process.env.SEU_PNG_PATH
      if (overridePath != null && overridePath !== '') {
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
  // the native dialog (e2e seam, same pattern as SEU_PDF_PATH/SEU_ANKI_PATH).
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
      const overridePath = process.env.SEU_SVG_PATH
      if (overridePath != null && overridePath !== '') {
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
  // SEU_PDF_PATH bypasses the native dialog (e2e/test seam; dev-only env).
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
      const overridePath = process.env.SEU_PDF_PATH
      if (overridePath != null && overridePath !== '') {
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
      const allowed = allowedRoots.some((root) => {
        const resolved = resolve(requested)
        return resolved === root || resolved.startsWith(root + sep)
      })
      if (!allowed) throw new Error('只能打开导出目录或附件目录中的文件')
      shell.showItemInFolder(requested)
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
      const note = noteRow != null ? parseNote(noteRow.note_json) : null
      const qaCtx = assembleContext(ctx.db, id, note)
      const messages = buildQaMessages(qaCtx, q)
      const capability = ctx.qaCapability()
      const client = ctx.chatFor(capability)
      const binding = ctx.providers().bindings.find((b) => b.capability === capability)
      if (binding == null) throw new Error('未绑定问答模型，请在设置中配置 text 或 multimodal 能力')
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
