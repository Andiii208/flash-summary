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
import { summarizeLesson, loadSummarizeInputs } from './notes/summarize'
import { printToPdfFile } from './notes/pdf-export'
import { parseNote } from '../shared/notes/schema'
import { noteToMarkdown } from '../shared/notes/markdown'
import { treeToSvg } from '../shared/notes/mindmap-svg'
import { ankiDecks, deckToTsv } from '../shared/notes/anki'
import { noteExportBaseName } from '../shared/notes/export-name'
import { okResult, errResult, type ApiResult } from '../shared/api-result'
import { formatBytes, formatSpeed } from '../shared/format'
import type { Note } from '../shared/notes/schema'
import { resolveCacheDir, attachmentsPath } from './library/paths'
import { migrateLibrary } from './library/migrate'
import { writeLibraryPointer } from './library/pointer'
import { getSetting } from './settings/store'

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
 * E1 (review): every handler verifies the caller is the app's own renderer.
 * While the main window is navigated to the school platform, its pages load
 * WITH the preload bridge attached — without this check they could reach
 * the full IPC surface (providers:save, settings writes, PDF export…).
 */
export function assertAppSender(e: unknown): void {
  const frame = (e as { senderFrame?: { url?: string } | null } | undefined)?.senderFrame
  const url = frame?.url ?? ''
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (url.startsWith('file://')) return
  if (devUrl != null && devUrl !== '' && url.startsWith(devUrl)) return
  throw new Error('非法调用方：该通道仅限应用自身界面调用')
}

function handle(target: HandleLike, channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void {
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
    await ctx.logout()
    return ok({ state: ctx.sessionState() })
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
    try {
      const cid = str(courseId, 'courseId')
      ctx.harvestRuntime.start(cid)
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
      ctx.harvestRuntime.finish(cid, { ok: true, lessons: harvest.lessons.length })
      return ok({ lessons: harvest.lessons.length })
    } catch (e) {
      ctx.logger.error(`harvestLessons failed: ${(e as Error).message}`)
      // 批C: the initiating renderer dies with the navigation — the outcome
      // is the only way the fresh mount can tell the user it failed.
      if (typeof courseId === 'string') ctx.harvestRuntime.finish(courseId, { ok: false, lessons: 0, error: (e as Error).message })
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
      const cid = str(courseId, 'courseId')
      const lid = str(lessonId, 'lessonId')
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
          `SELECT c.id, c.name, c.term, c.teacher, c.subj_code, c.classroom, c.cour_times, c.is_mine,
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
        note_count: number
        last_task_at: string | null
      }>
      const lessonRows = ctx.db
        .prepare(
          `SELECT l.id, l.course_id, l.title, l.started_at,
                  (SELECT COUNT(*) FROM notes n WHERE n.lesson_id = l.id) AS note_count
           FROM lessons l ORDER BY l.started_at, l.id`
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
      const cid = str(courseId, 'courseId')
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
      const cid = str(courseId, 'courseId')
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
      return ok({ libraryRoot: s.libraryRoot, cacheDir: resolveCacheDir(s.cacheDir, s.libraryRoot), theme: s.theme, version: app.getVersion() })
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
  handle(ipc, 'settings:openPath', (_e, kind: unknown) => {
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
      void shell.openPath(target)
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

  // ---- tasks ----
  handle(ipc, 'tasks:create', (_e, lessonId: unknown) => {
    try {
      const id = newId()
      new TaskRepository(ctx.db).create(id, str(lessonId, 'lessonId'))
      return ok({ id })
    } catch (e) {
      return err(e)
    }
  })
  // tasks:list (U1): history so the UI can show past/failed tasks.
  // M1-2: JOIN lessons/courses so rows read as «课程名 · 课时名» — the raw
  // lesson id means nothing to a user.
  handle(ipc, 'tasks:list', (_e, lessonId: unknown) => {
    try {
      const baseSelect =
        'SELECT t.id, t.lesson_id, t.state, t.failed_stage, t.error_message, t.error_kind, t.created_at, t.updated_at, l.title AS lesson_title, c.name AS course_name, c.teacher AS teacher, c.cour_times AS courTimes, c.classroom AS classroom FROM tasks t LEFT JOIN lessons l ON t.lesson_id = l.id LEFT JOIN courses c ON l.course_id = c.id'
      const rows = (
        lessonId == null
          ? ctx.db.prepare(`${baseSelect} ORDER BY t.created_at DESC LIMIT 50`).all()
          : ctx.db.prepare(`${baseSelect} WHERE t.lesson_id = ? ORDER BY t.created_at DESC LIMIT 50`).all(str(lessonId, 'lessonId'))
      ) as Array<{
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
      return ok(rows)
    } catch (e) {
      return err(e)
    }
  })

  // M1-2: delete one history row (and its stage evidence + cache dir).
  // A running task cannot be deleted — cancel it first.
  handle(ipc, 'tasks:delete', (_e, taskId: unknown) => {
    try {
      const id = str(taskId, 'taskId')
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
  // tasks:runAsync (U4): enqueued on the serial executor (at most one task
  // runs at a time); progress streams via 'tasks:progress'. Errors surface
  // as a failed progress event plus the returned envelope.
  handle(ipc, 'tasks:runAsync', async (_e, taskId: unknown) => {
    try {
      const id = str(taskId, 'taskId')
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
        .catch((e) => {
          sendProgress({ taskId: id, state: 'failed', stage: null, message: (e as Error).message, percent: 0 })
        })
        .finally(() => {
          abortControllers.delete(id)
          notifyIdle()
        })
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
      sendProgress({ taskId: id, state: 'failed', stage: failedStage, message: '任务已取消', percent: 0, kind: 'cancelled' })
      if (queue.members().includes(id)) cancelledWhileQueued.add(id)
    }
  }
  handle(ipc, 'tasks:cancel', (_e, taskId: unknown) => {
    try {
      cancelById(str(taskId, 'taskId'))
      return ok({ cancelled: true })
    } catch (e) {
      return err(e)
    }
  })

  // ---- notes ----
  handle(ipc, 'notes:latest', (_e, lessonId: unknown) => {
    try {
      const id = str(lessonId, 'lessonId')
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
  handle(ipc, 'notes:list', () => {
    try {
      const rows = ctx.db
        .prepare(
          `SELECT n.lesson_id AS lessonId, MAX(n.version) AS version, MAX(n.created_at) AS createdAt,
                  l.title AS lessonTitle, c.name AS courseName, c.teacher
           FROM notes n
           JOIN lessons l ON l.id = n.lesson_id
           LEFT JOIN courses c ON c.id = l.course_id
           GROUP BY n.lesson_id
           ORDER BY createdAt DESC
           LIMIT 200`
        )
        .all() as Array<{
        lessonId: string
        version: number
        createdAt: string
        lessonTitle: string | null
        courseName: string | null
        teacher: string | null
      }>
      return ok(rows)
    } catch (e) {
      return err(e)
    }
  })
  // Export the latest note as Markdown via the system save dialog (U3).
  handle(ipc, 'notes:exportMarkdown', async (_e, lessonId: unknown) => {
    try {
      const id = str(lessonId, 'lessonId')
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
      const id = str(lessonId, 'lessonId')
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

  // M3.3 (map expansion 2026-09-05): export the knowledge tree as a
  // standalone paper-white SVG via the save dialog. SEU_SVG_PATH bypasses
  // the native dialog (e2e seam, same pattern as SEU_PDF_PATH/SEU_ANKI_PATH).
  handle(ipc, 'notes:exportSvg', async (_e, lessonId: unknown) => {
    try {
      const id = str(lessonId, 'lessonId')
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

  // 2026-09-04: attachments (keyframes + PPT pages) as data URLs for the note views.
  handle(ipc, 'notes:attachments', (_e, lessonId: unknown) => {
    try {
      // F4 (review): the manifest is identity-only — data URLs stream in
      // per ref via notes:attachmentData instead of one giant IPC message.
      return ok(listAttachmentManifest(ctx.db, str(lessonId, 'lessonId')))
    } catch (e) {
      return err(e)
    }
  })

  // F4 (review): one attachment's bytes per call — renderer caches per ref.
  handle(ipc, 'notes:attachmentData', (_e, lessonId: unknown, ref: unknown) => {
    try {
      const id = str(lessonId, 'lessonId')
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
      const id = str(lessonId, 'lessonId')
      // Input checks first: a missing transcript should not masquerade as a
      // provider-binding problem (chatFor throws when unbound).
      const inputs = loadSummarizeInputs(ctx.db, id, ctx.libraryRoot)
      if ('error' in inputs) return err(new Error(inputs.error))
      if (queue.current() != null) return err(new Error('任务运行中，请等待完成后再重新生成笔记'))
      const runningForLesson = ctx.db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE lesson_id = ? AND state IN ('pending','summarizing','transcribing','extracting_visuals','extracting_audio','downloading_video','fetching_course')")
        .get(id) as { n: number }
      if (runningForLesson.n > 0) return err(new Error('该课时存在排队/运行中的任务，请等待完成后再重新生成笔记'))
      const client = ctx.chatFor('multimodal')
      const result = await summarizeLesson(ctx.db, client, id, ctx.libraryRoot)
      if ('error' in result) return err(new Error(result.error))
      return ok(result)
    } catch (e) {
      return err(e)
    }
  })

  // 2026-09-04: PDF handout export — step 1, pick the target file.
  // SEU_PDF_PATH bypasses the native dialog (e2e/test seam; dev-only env).
  handle(ipc, 'notes:exportPdfDialog', async (_e, lessonId: unknown) => {
    try {
      const id = str(lessonId, 'lessonId')
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
      // the exports/attachments roots the request is refused.
      const requested = str(filePath, 'filePath')
      const allowedRoots = [ctx.exportsDir(), attachmentsPath(ctx.libraryRoot)]
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
      const id = str(lessonId, 'lessonId')
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
        .all(str(lessonId, 'lessonId')) as Array<{ question: string; answer: string; created_at: string }>
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
