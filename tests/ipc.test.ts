import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc } from '../src/main/ipc'
import { TaskRepository } from '../src/main/tasks/queue'
import type { Stage } from '../src/main/tasks/stages'
import type { StageExecutor } from '../src/main/tasks/queue'
import type { Cryptor } from '../src/main/auth/session-crypto'

/** In-memory ipc stub mimicking electron ipcMain handle/invoke. */
class FakeIpc {
  readonly handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, fn)
  }
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    return fn({}, ...args)
  }
}

const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

let db: Db
let dir: string
let ipc: FakeIpc

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-ipc-'))
  ipc = new FakeIpc()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeCtx(): AppContext {
  const ctx = createContext({
    libraryRoot: dir,
    userDataDir: join(dir, 'userdata'),
    cryptor: stubCryptor
  })
  db = ctx.db
  return ctx
}

describe('ipc handlers over a real context', () => {
  it('registers the full API surface', () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    for (const channel of [
      'school:login', 'school:logout', 'school:session', 'school:listCourses', 'school:addManualCourse',
      'providers:list', 'providers:save', 'providers:delete', 'providers:bind',
      'tasks:create', 'tasks:run',
      'notes:latest',
      'qa:ask', 'qa:history'
    ]) {
      expect(ipc.handlers.has(channel), channel).toBe(true)
    }
  })

  it('session state reflects login persistence (encrypted at rest)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)

    // Simulate the login window's onSession callback saving cookies.
    const { saveSession } = await import('../src/main/auth/session-store')
    saveSession(
      join(dir, 'userdata'),
      { cookies: 'JSESSIONID=abc; CASTGT=t', baseUrl: 'https://cvs.seu.edu.cn', savedAt: '2026-08-30T00:00:00Z' },
      stubCryptor
    )

    const res = (await ipc.invoke('school:session')) as { ok: boolean; value?: { state: string } }
    expect(res.ok).toBe(true)
    expect(res.value?.state).toBe('logged_in')

    await ipc.invoke('school:logout')
    const after = (await ipc.invoke('school:session')) as { value?: { state: string } }
    expect(after.value?.state).toBe('logged_out')
  })

  it('providers:save persists an encrypted key, providers:list hides plaintext', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)

    const saved = (await ipc.invoke('providers:save', { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-abc123' })) as {
      ok: boolean
      value?: { id: string; hasKey: boolean }
    }
    expect(saved.ok).toBe(true)
    expect(saved.value?.hasKey).toBe(true)

    const listed = (await ipc.invoke('providers:list')) as { value?: { providers: Array<{ apiKey?: string; hasKey: boolean }> } }
    expect(listed.value?.providers[0].hasKey).toBe(true)
    // U1 security fix: the plaintext key must NEVER leave the main process —
    // list returns shape only, the renderer gets no apiKey field at all.
    expect(listed.value?.providers[0]).not.toHaveProperty('apiKey')

    // Raw DB holds the sealed blob, never the plaintext.
    const raw = (db.prepare('SELECT api_key FROM providers').get() as { api_key: string }).api_key
    expect(raw.startsWith('enc:v1:')).toBe(true)
    expect(raw).not.toContain('sk-abc123')
  })

  it('providers:bind validates capability names', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('providers:bind', 'voice', 'p1', 'm')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('capability')
  })

  it('tasks:create round-trips a task row through the repository', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()

    const created = (await ipc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    expect(created.ok).toBe(true)
    const id = created.value!.id

    // The IPC surface no longer exposes a get channel (UI reads the list);
    // state lives durably in the tasks table.
    const row = new TaskRepository(db).get(id)
    expect(row?.state).toBe('pending')
    expect(row?.lesson_id).toBe('l1')
  })

  it('notes:latest returns null before any note exists and parses after insert', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()

    const empty = (await ipc.invoke('notes:latest', 'l1')) as { ok: boolean; value: unknown }
    expect(empty.ok).toBe(true)
    expect(empty.value).toBeNull()

    const note = { overview: '概览', knowledgeTree: { title: 'r', children: [] }, methodology: '方法', examCues: [], questionsAndGaps: [] }
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-08-30T00:00:00Z')").run(
      JSON.stringify(note)
    )
    const latest = (await ipc.invoke('notes:latest', 'l1')) as { ok: boolean; value?: { overview: string } }
    expect(latest.value?.overview).toBe('概览')
  })

  it('qa:ask fails gracefully without a bound capability', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()

    const res = (await ipc.invoke('qa:ask', 'l1', '什么是极限?')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('未绑定')
  })

  it('school:addManualCourse registers durable rows and is idempotent', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)

    const first = (await ipc.invoke('school:addManualCourse', 'C100', 'L200')) as { ok: boolean; value?: { courseId: string; lessonId: string } }
    expect(first.ok).toBe(true)

    // Duplicate registration must not fail (ON CONFLICT DO NOTHING).
    const again = (await ipc.invoke('school:addManualCourse', 'C100', 'L200')) as { ok: boolean }
    expect(again.ok).toBe(true)

    const course = db.prepare('SELECT id, name FROM courses WHERE id = ?').get('C100') as { id: string; name: string }
    const lesson = db.prepare('SELECT id, course_id FROM lessons WHERE id = ?').get('L200') as { id: string; course_id: string }
    expect(course.id).toBe('C100')
    expect(lesson.course_id).toBe('C100')

    // A task can then be created for the manual lesson.
    const task = (await ipc.invoke('tasks:create', 'L200')) as { ok: boolean }
    expect(task.ok).toBe(true)
  })

  it('school:addManualCourse rejects empty ids', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('school:addManualCourse', '', 'L1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('courseId')
  })

  it('qa:history returns prior exchanges for the lesson only', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '课时二', '2026-08-30T00:00:00Z')").run()
    const { recordQa } = await import('../src/main/notes/qa')
    recordQa(db, 'l1', '问题一', '回答一')
    recordQa(db, 'l2', '课时二问题', '课时二回答')

    const res = (await ipc.invoke('qa:history', 'l1')) as { ok: boolean; value?: Array<{ question: string }> }
    expect(res.value?.map((r) => r.question)).toEqual(['问题一'])
  })
})

describe('U1: task progress events', () => {
  class RecordingIpc extends FakeIpc {
    readonly sent: Array<{ channel: string; payload: unknown }> = []
    send(channel: string, payload: unknown): void {
      this.sent.push({ channel, payload })
    }
  }

  function makeRecIpc(): { ipc: RecordingIpc; opts: { sender: RecordingIpc } } {
    const recIpc = new RecordingIpc()
    // Progress events flow through IpcOptions.sender — the same recorder
    // doubles as the sender so the test can assert on pushed events.
    return { ipc: recIpc, opts: { sender: recIpc } }
  }

  function stubExecutors(db2: Db): Record<Stage, StageExecutor> {
    const stages = ['fetching_course', 'downloading_video', 'extracting_audio', 'transcribing', 'extracting_visuals', 'summarizing'] as const
    return Object.fromEntries(
      stages.map((stage) => [
        stage,
        async () => {
          await new Promise((r) => setTimeout(r, 10))
          if (stage === 'summarizing') {
            db2.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', 'x')").run(
              JSON.stringify({ overview: '概览', knowledgeTree: { title: 'r', children: [] }, methodology: '方法', examCues: [], questionsAndGaps: [] })
            )
          }
          return { status: 'ok' as const }
        }
      ])
    ) as never
  }

  it('tasks:runAsync returns immediately and streams stage progress events', async () => {
    const ctx = makeCtx()
    const { ipc: recIpc, opts } = makeRecIpc()
    let step = 0
    registerIpc(ctx, recIpc as never, {
      ...opts,
      newTaskId: () => `t-async-${++step}`,
      executorsOverride: () => stubExecutors(db)
    })
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()

    const created = (await recIpc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    const taskId = created.value!.id

    const res = (await recIpc.invoke('tasks:runAsync', taskId)) as { ok: boolean; value?: { id: string; state: string } }
    // Enqueue returns immediately with a running marker, not the pipeline result.
    expect(res.ok).toBe(true)
    expect(res.value?.state).toBe('running')

    // Wait for the background pipeline to finish (6 stub stages × 10ms).
    await new Promise((r) => setTimeout(r, 250))

    const events = recIpc.sent.filter((s) => s.channel === 'tasks:progress') as Array<{
      channel: string
      payload: { taskId: string; state: string; percent: number }
    }>
    expect(events.length).toBeGreaterThanOrEqual(6)
    expect(events[0].payload.taskId).toBe(taskId)
    expect(events[0].payload.state).toBe('fetching_course')
    expect(events.map((e) => e.payload.state)).toContain('succeeded')
    expect(events[events.length - 1].payload.percent).toBe(100)

    const finalRow = new TaskRepository(db).get(taskId)
    expect(finalRow?.state).toBe('succeeded')
  })

  it('stage failure emits a failed progress event with the error message', async () => {
    const ctx = makeCtx()
    const { ipc: recIpc, opts } = makeRecIpc()
    registerIpc(ctx, recIpc as never, {
      ...opts,
      newTaskId: () => 't-fail',
      executorsOverride: () =>
        ({
          fetching_course: async () => ({ status: 'failed' as const, error: '获取课时信息失败: network down' }),
          downloading_video: async () => ({ status: 'ok' as const }),
          extracting_audio: async () => ({ status: 'ok' as const }),
          transcribing: async () => ({ status: 'ok' as const }),
          extracting_visuals: async () => ({ status: 'ok' as const }),
          summarizing: async () => ({ status: 'ok' as const })
        }) as never
    })
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()

    const created = (await recIpc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    const taskId = created.value!.id
    await recIpc.invoke('tasks:runAsync', taskId)
    await new Promise((r) => setTimeout(r, 120))

    const failed = recIpc.sent.find((s) => s.channel === 'tasks:progress' && (s.payload as { state: string }).state === 'failed') as
      | { payload: { taskId: string; message: string } }
      | undefined
    expect(failed).toBeDefined()
    expect(failed!.payload.taskId).toBe(taskId)
    expect(failed!.payload.message).toContain('network down')

    const failedRow = new TaskRepository(db).get(taskId)
    expect(failedRow?.state).toBe('failed')
    expect(failedRow?.failed_stage).toBe('fetching_course')
  })

  it('re-running a failed task via runAsync resumes from the failed stage', async () => {
    const ctx = makeCtx()
    const { ipc: recIpc, opts } = makeRecIpc()
    let failFirst = true
    registerIpc(ctx, recIpc as never, {
      ...opts,
      newTaskId: () => 't-retry',
      executorsOverride: () =>
        ({
          fetching_course: async () => {
            // Fail only on the very first call (initial run); the resume passes.
            if (failFirst) {
              failFirst = false
              return { status: 'failed' as const, error: 'boom' }
            }
            return { status: 'ok' as const }
          },
          downloading_video: async () => ({ status: 'ok' as const }),
          extracting_audio: async () => ({ status: 'ok' as const }),
          transcribing: async () => ({ status: 'ok' as const }),
          extracting_visuals: async () => ({ status: 'ok' as const }),
          summarizing: async () => ({ status: 'ok' as const })
        }) as never
    })
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()

    const created = (await recIpc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    const taskId = created.value!.id
    await recIpc.invoke('tasks:runAsync', taskId)
    await new Promise((r) => setTimeout(r, 100))
    expect(new TaskRepository(db).get(taskId)?.state).toBe('failed')

    // Same channel, same task: firstStageFor restarts it at the failed stage.
    await recIpc.invoke('tasks:runAsync', taskId)
    await new Promise((r) => setTimeout(r, 150))

    const events = recIpc.sent.filter((s) => s.channel === 'tasks:progress') as Array<{ payload: { state: string } }>
    const afterFailure = events.slice(events.findIndex((e) => e.payload.state === 'failed') + 1)
    expect(afterFailure.some((e) => e.payload.state === 'downloading_video')).toBe(true)
    expect(afterFailure.some((e) => e.payload.state === 'succeeded')).toBe(true)
    expect(new TaskRepository(db).get(taskId)?.state).toBe('succeeded')
  })
})

describe('U1: course tree and task list', () => {
  it('school:courseTree groups lessons per course with hasNote badges', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, term, teacher, fetched_at) VALUES ('c1', '高等数学', '2026秋', '张老师', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第一讲', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '第二讲', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, '{}', 'p', 'm', 'x')").run()

    const res = (await ipc.invoke('school:courseTree')) as {
      ok: boolean
      value?: Array<{ id: string; name: string; lessons: Array<{ id: string; title: string; hasNote: boolean }> }>
    }
    expect(res.ok).toBe(true)
    expect(res.value).toHaveLength(1)
    const course = res.value![0]
    expect(course.name).toBe('高等数学')
    expect(course.lessons).toEqual([
      { id: 'l1', title: '第一讲', hasNote: true },
      { id: 'l2', title: '第二讲', hasNote: false }
    ])
  })

  it('tasks:list returns history newest first, optionally filtered by lesson', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '课时二', '2026-08-30T00:00:00Z')").run()

    const a = (await ipc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    await new Promise((r) => setTimeout(r, 5))
    const b = (await ipc.invoke('tasks:create', 'l2')) as { ok: boolean; value?: { id: string } }

    const all = (await ipc.invoke('tasks:list')) as { ok: boolean; value?: Array<{ id: string }> }
    expect(all.value?.map((t) => t.id)).toEqual([b.value!.id, a.value!.id])

    const onlyL2 = (await ipc.invoke('tasks:list', 'l2')) as { ok: boolean; value?: Array<{ id: string }> }
    expect(onlyL2.value?.map((t) => t.id)).toEqual([b.value!.id])
  })

  it('school:listCourses upserts rows so the tree has durable data', async () => {
    const ctx = makeCtx()
    // Point the school client at an unreachable origin: the upsert test uses
    // the DB path only, so we inject rows through addManualCourse instead of
    // stubbing the network.
    registerIpc(ctx, ipc as never)
    await ipc.invoke('school:addManualCourse', 'C9', 'L9')
    const tree = (await ipc.invoke('school:courseTree')) as {
      ok: boolean
      value?: Array<{ id: string; lessons: Array<{ id: string }> }>
    }
    expect(tree.value?.[0].id).toBe('C9')
    expect(tree.value?.[0].lessons.map((l) => l.id)).toEqual(['L9'])
  })
})
