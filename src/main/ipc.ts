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
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppContext } from './app-context'
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

/** Progress-channel interface so tests can substitute a fake sender. */
export interface ProgressSender {
  send: (channel: string, payload: TaskProgress) => void
}

export interface IpcOptions {
  /** Main window webContents; progress events go here when present. */
  sender?: ProgressSender
  /** Overrides the auto task id (used by tests for determinism). */
  newTaskId?: () => string
  /** Test hook: replace the pipeline executors (progress tests stub stages). */
  executorsOverride?: () => Record<Stage, StageExecutor>
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
  ipc.handle('school:session', () => ok({ state: ctx.sessionState() }))

  // ---- courses / lessons ----
  // The school list is the source; rows are upserted into the library so the
  // course tree (school:courseTree) has durable data even offline.
  ipc.handle('school:listCourses', async () => {
    try {
      const courses = await ctx.school.listCourses()
      const now = new Date().toISOString()
      const upsert = ctx.db.prepare(
        `INSERT INTO courses (id, name, term, teacher, tecl_id, tecl_code, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, term = excluded.term,
           teacher = excluded.teacher, tecl_id = excluded.tecl_id, tecl_code = excluded.tecl_code,
           fetched_at = excluded.fetched_at`
      )
      for (const c of courses) {
        if (c.id === '') continue
        upsert.run(c.id, c.name, c.term ?? null, c.teacher ?? null, c.teclId ?? null, c.teclCode ?? null, now)
      }
      return ok(courses)
    } catch (e) {
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
        .prepare('SELECT id, name, term, teacher FROM courses ORDER BY fetched_at DESC')
        .all() as Array<{ id: string; name: string; term: string | null; teacher: string | null }>
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
        lessons: lessonRows
          .filter((l) => l.course_id === c.id)
          .map((l) => ({ id: l.id, title: l.title, hasNote: l.note_count > 0 }))
      }))
      return ok(tree)
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
