/**
 * IPC API surface: thin handlers over the AppContext.
 * Each handler validates argument shapes and converts provider/school
 * errors into { ok:false, error, kind } envelopes the renderer can show.
 *
 * Task execution is asynchronous: tasks:runAsync enqueues and returns
 * immediately; stage progress is pushed to the main window over the
 * 'tasks:progress' channel so the renderer never blocks.
 */
import { ipcMain, dialog, shell, BrowserWindow, type WebContents, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { lookup as dnsLookup } from 'dns/promises'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppContext } from './app-context'
import type { Db } from './db/open'
import { isFakeIpResolution } from './net-diagnostics'
import { TaskRepository, runTask, type TaskProgress } from './tasks/queue'
import { SerialTaskQueue } from './tasks/serial-queue'
import { createExecutors } from './tasks/orchestrator'
import type { Stage } from './tasks/stages'
import { stagePercent } from './tasks/stages'
import type { StageExecutor } from './tasks/queue'
import { assembleContext, buildQaMessages, recordQa } from './notes/qa'
import { parseNote } from '../shared/notes/schema'
import { noteToMarkdown } from '../shared/notes/markdown'
import { okResult, errResult, type ApiResult } from '../shared/api-result'
import type { Note } from '../shared/notes/schema'
import { resolveCacheDir } from './library/paths'
import { migrateLibrary } from './library/migrate'
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

/** Compute the resume point for a task: pending stages start from the top,
 *  failed tasks resume from their failed stage. */
function firstStageFor(state: string, failedStage: string | null): Parameters<typeof runTask>[3] {
  if (state === 'failed' && failedStage != null) return failedStage as Parameters<typeof runTask>[3]
  return 'fetching_course'
}

/** Progress-channel interface so tests can substitute a fake sender.
 *  Payload is widened to object: the channel carries task progress and
 *  refresh progress (school:refreshProgress) alike. */
export interface ProgressSender {
  send: (channel: string, payload: object) => void
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
}

export function registerIpc(ctx: AppContext, ipc = ipcMain, options: IpcOptions = {}): void {
  // Serial task executor + cancellation registry (U4): one task at a time,
  // cancellable via AbortController keyed by task id.
  const queue = new SerialTaskQueue()
  const abortControllers = new Map<string, AbortController>()
  const abortOf = (taskId: string): AbortSignal | undefined => abortControllers.get(taskId)?.signal

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
      }
    })

  const newId = options.newTaskId ?? (() => `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  // ---- school session ----
  ipc.handle('school:login', async () => {
    try {
      await ctx.login()
      return ok({ state: ctx.sessionState() })
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('school:logout', () => {
    ctx.logout()
    return ok({ state: ctx.sessionState() })
  })
  // justLoggedIn is the one-shot «a login flow just completed» marker: the
  // renderer's fresh mount (after the in-window login navigation) uses it to
  // auto-refresh the course tree. savedAt/expiresAt feed the settings page
  // and the «已过期» badge (local JWT-exp judgement, no network).
  ipc.handle('school:session', () => {
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
  ipc.handle('school:netCheck', async () => {
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
  ipc.handle('school:listCourses', async () => {
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
  ipc.handle('school:harvestLessons', async (_e, courseId: unknown) => {
    try {
      const cid = str(courseId, 'courseId')
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
      return ok({ lessons: harvest.lessons.length })
    } catch (e) {
      ctx.logger.error(`harvestLessons failed: ${(e as Error).message}`)
      return err(e)
    }
  })

  // Manual fallback entry (spec §2): register a course/lesson by id when the
  // school API list is unavailable. The task's fetching_course stage will
  // pull the real detail later; here we only need durable rows to exist.
  ipc.handle('school:addManualCourse', (_e, courseId: unknown, lessonId: unknown) => {
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
  ipc.handle('school:courseTree', () => {
    try {
      const courses = ctx.db
        .prepare('SELECT id, name, term, teacher, subj_code, classroom, cour_times, is_mine FROM courses ORDER BY fetched_at DESC')
        .all() as Array<{
        id: string
        name: string
        term: string | null
        teacher: string | null
        subj_code: string | null
        classroom: string | null
        cour_times: string | null
        is_mine: number
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
        lessons: lessonRows
          .filter((l) => l.course_id === c.id)
          .map((l) => ({ id: l.id, title: l.title, hasNote: l.note_count > 0 }))
      }))
      return ok(tree)
    } catch (e) {
      return err(e)
    }
  })

  // C2: pin/unpin a course as «mine». The schedule-API probe may automate
  // this later; until then the user decides, and the sidebar sorts pinned
  // courses (plus their same-subject sections) to the top.
  ipc.handle('school:setMine', (_e, courseId: unknown, mine: unknown) => {
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
  ipc.handle('providers:list', () =>
    ok({
      providers: ctx.providers().providers.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, hasKey: p.hasKey })),
      bindings: ctx.providers().bindings
    })
  )
  ipc.handle('providers:save', (_e, input: unknown) => {
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
  ipc.handle('providers:delete', (_e, id: unknown) => {
    try {
      ctx.removeProvider(str(id, 'id'))
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('providers:bind', (_e, capability: unknown, providerId: unknown, model: unknown) => {
    try {
      const cap = str(capability, 'capability')
      if (cap !== 'asr' && cap !== 'multimodal' && cap !== 'text') throw new Error('unknown capability')
      ctx.bind(cap, str(providerId, 'providerId'), str(model, 'model'))
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // ---- settings (U3) ----
  ipc.handle('settings:get', () => {
    try {
      const s = ctx.settings()
      return ok({ libraryRoot: s.libraryRoot, cacheDir: resolveCacheDir(s.cacheDir, s.libraryRoot), theme: s.theme })
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('settings:setCacheDir', (_e, dir: unknown) => {
    try {
      const d = str(dir, 'cacheDir')
      assertWritable(d)
      ctx.setSetting('cacheDir', d)
      return ok({ cacheDir: resolveCacheDir(d, ctx.settings().libraryRoot) })
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('settings:setTheme', (_e, theme: unknown) => {
    try {
      const t = str(theme, 'theme')
      if (t !== 'auto' && t !== 'light' && t !== 'dark') throw new Error('invalid theme (auto|light|dark)')
      ctx.setSetting('theme', t)
      return ok({ theme: t })
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('settings:chooseLibrary', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const options: OpenDialogOptions = { title: '选择新的资料库目录（需为空目录）', properties: ['openDirectory', 'createDirectory'] }
      const result = win == null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options)
      if (result.canceled || result.filePaths.length === 0) return ok({ canceled: true })
      const migration = await migrateLibrary(ctx.db, ctx.libraryRoot, result.filePaths[0] as string)
      if (!migration.ok) return err(new Error(migration.error))
      ctx.setSetting('libraryRoot', migration.dest)
      return ok({ canceled: false, libraryRoot: migration.dest, restartRequired: true })
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('settings:openPath', (_e, kind: unknown) => {
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
  ipc.handle('log:rendererError', (_e, message: unknown) => {
    try {
      ctx.logger.error(`renderer: ${str(message, 'message')}`)
      return ok(true)
    } catch (e) {
      return err(e)
    }
  })

  // ---- tasks ----
  ipc.handle('tasks:create', (_e, lessonId: unknown) => {
    try {
      const id = newId()
      new TaskRepository(ctx.db).create(id, str(lessonId, 'lessonId'))
      return ok({ id })
    } catch (e) {
      return err(e)
    }
  })
  // tasks:list (U1): history so the UI can show past/failed tasks.
  ipc.handle('tasks:list', (_e, lessonId: unknown) => {
    try {
      const rows = (
        lessonId == null
          ? ctx.db.prepare('SELECT id, lesson_id, state, failed_stage, error_message, error_kind, created_at, updated_at FROM tasks ORDER BY created_at DESC LIMIT 50').all()
          : ctx.db
              .prepare(
                'SELECT id, lesson_id, state, failed_stage, error_message, error_kind, created_at, updated_at FROM tasks WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 50'
              )
              .all(str(lessonId, 'lessonId'))
      ) as Array<{ id: string; lesson_id: string; state: string; failed_stage: string | null; error_message: string | null; error_kind: string | null; created_at: string; updated_at: string }>
      return ok(rows)
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('tasks:run', async (_e, taskId: unknown) => {
    try {
      const id = str(taskId, 'taskId')
      const repo = new TaskRepository(ctx.db)
      const row = repo.get(id)
      if (row == null) throw new Error(`task ${id} not found`)
      const executors = makeExecutors()
      const result = await runTask(repo, id, executors, firstStageFor(row.state, row.failed_stage), sendProgress, abortOf(id))
      return ok({ result, task: repo.get(id) })
    } catch (e) {
      return err(e)
    }
  })
  // tasks:runAsync (U4): enqueued on the serial executor (at most one task
  // runs at a time); progress streams via 'tasks:progress'. Errors surface
  // as a failed progress event plus the returned envelope.
  ipc.handle('tasks:runAsync', async (_e, taskId: unknown) => {
    try {
      const id = str(taskId, 'taskId')
      const repo = new TaskRepository(ctx.db)
      const row = repo.get(id)
      if (row == null) throw new Error(`task ${id} not found`)
      const controller = new AbortController()
      abortControllers.set(id, controller)
      void queue.enqueue(id, () =>
        runTask(repo, id, makeExecutors(), firstStageFor(row.state, row.failed_stage), sendProgress, controller.signal)
          .catch((e) => {
            sendProgress({ taskId: id, state: 'failed', stage: null, message: (e as Error).message, percent: 0 })
          })
          .finally(() => abortControllers.delete(id))
      )
      return ok({ id, state: 'running' })
    } catch (e) {
      return err(e)
    }
  })
  // tasks:cancel (U4): abort the running/queued task; it flips to failed(cancelled).
  ipc.handle('tasks:cancel', (_e, taskId: unknown) => {
    try {
      const id = str(taskId, 'taskId')
      const controller = abortControllers.get(id)
      if (controller != null) {
        controller.abort()
        return ok({ cancelled: true })
      }
      // Not currently running: mark failed(cancelled) directly so the UI state is consistent.
      const repo = new TaskRepository(ctx.db)
      const row = repo.get(id)
      if (row != null && row.state !== 'succeeded' && row.state !== 'failed') {
        repo.markFailed(id, (row.state as Stage) ?? 'pending', '任务已取消', 'cancelled')
        sendProgress({ taskId: id, state: 'failed', stage: row.state as Stage, message: '任务已取消', percent: 0, kind: 'cancelled' })
      }
      return ok({ cancelled: true })
    } catch (e) {
      return err(e)
    }
  })

  // ---- notes ----
  ipc.handle('notes:latest', (_e, lessonId: unknown) => {
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
  // Export the latest note as Markdown via the system save dialog (U3).
  ipc.handle('notes:exportMarkdown', async (_e, lessonId: unknown) => {
    try {
      const id = str(lessonId, 'lessonId')
      const row = ctx.db
        .prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1')
        .get(id) as { note_json: string } | undefined
      if (row == null) throw new Error('该课时尚无笔记')
      const lesson = ctx.db.prepare('SELECT title FROM lessons WHERE id = ?').get(id) as { title: string } | undefined
      const title = lesson?.title ?? id
      const md = noteToMarkdown(parseNote(row.note_json), title)
      const win = BrowserWindow.getFocusedWindow()
      const options: SaveDialogOptions = {
        title: '导出笔记为 Markdown',
        defaultPath: join(ctx.exportsDir(), `${safeFileName(title)}.md`),
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

  // ---- Q&A ----
  ipc.handle('qa:ask', async (_e, lessonId: unknown, question: unknown) => {
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
  ipc.handle('qa:history', (_e, lessonId: unknown) => {
    try {
      const rows = ctx.db
        .prepare('SELECT question, answer, created_at FROM qa WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(str(lessonId, 'lessonId')) as Array<{ question: string; answer: string; created_at: string }>
      return ok(rows)
    } catch (e) {
      return err(e)
    }
  })
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

/** Strip characters that are unsafe in a Windows file name. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'note'
}
