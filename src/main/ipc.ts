/**
 * IPC API surface: thin handlers over the AppContext.
 * Each handler validates argument shapes and converts provider/school
 * errors into { ok:false, error, kind } envelopes the renderer can show.
 */
import { ipcMain } from 'electron'
import type { AppContext } from './app-context'
import { TaskRepository, runTask, retryTask } from './tasks/queue'
import { createExecutors } from './tasks/orchestrator'
import { assembleContext, buildQaMessages, recordQa } from './notes/qa'
import { parseNote } from '../shared/notes/schema'
import { okResult, errResult, type ApiResult } from '../shared/api-result'
import type { Note } from '../shared/notes/schema'

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

/** Compute the resume point for a task: pending stages start from the top,
 *  failed tasks resume from their failed stage. */
function firstStageFor(state: string, failedStage: string | null): Parameters<typeof runTask>[4] {
  if (state === 'failed' && failedStage != null) return failedStage as Parameters<typeof runTask>[4]
  return 'fetching_course'
}

export function registerIpc(ctx: AppContext, ipc = ipcMain): void {
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
  ipc.handle('school:listCourses', async () => {
    try {
      return ok(await ctx.school.listCourses())
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

  // ---- providers ----
  ipc.handle('providers:list', () => ok(ctx.providers()))
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

  // ---- tasks ----
  ipc.handle('tasks:create', (_e, lessonId: unknown) => {
    try {
      const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      new TaskRepository(ctx.db).create(id, str(lessonId, 'lessonId'))
      return ok({ id })
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('tasks:get', (_e, taskId: unknown) => {
    try {
      const row = new TaskRepository(ctx.db).get(str(taskId, 'taskId'))
      return ok(row ?? null)
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
      const executors = createExecutors({
        db: ctx.db,
        libraryRoot: ctx.libraryRoot,
        ffmpeg: ctx.ffmpegPath(),
        ffprobe: ctx.ffprobePath(),
        school: ctx.school,
        chat: (capability) => ctx.chatFor(capability),
        gridDecoder: ctx.gridDecoder
      })
      const result = await runTask(repo, id, executors, ctx.stageOutputs, firstStageFor(row.state, row.failed_stage))
      return ok({ result, task: repo.get(id) })
    } catch (e) {
      return err(e)
    }
  })
  ipc.handle('tasks:retry', async (_e, taskId: unknown) => {
    try {
      const id = str(taskId, 'taskId')
      const repo = new TaskRepository(ctx.db)
      const executors = createExecutors({
        db: ctx.db,
        libraryRoot: ctx.libraryRoot,
        ffmpeg: ctx.ffmpegPath(),
        ffprobe: ctx.ffprobePath(),
        school: ctx.school,
        chat: (capability) => ctx.chatFor(capability),
        gridDecoder: ctx.gridDecoder
      })
      const result = await retryTask(repo, id, executors, ctx.stageOutputs)
      return ok({ result, task: repo.get(id) })
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
  ipc.handle('notes:versions', (_e, lessonId: unknown) => {
    try {
      const rows = ctx.db
        .prepare('SELECT version, created_at FROM notes WHERE lesson_id = ? ORDER BY version DESC')
        .all(str(lessonId, 'lessonId')) as Array<{ version: number; created_at: string }>
      return ok(rows)
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
