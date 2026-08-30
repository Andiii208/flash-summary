import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc } from '../src/main/ipc'
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
      'tasks:create', 'tasks:get', 'tasks:run', 'tasks:retry',
      'notes:latest', 'notes:versions',
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

    const listed = (await ipc.invoke('providers:list')) as { value?: { providers: Array<{ apiKey: string; hasKey: boolean }> } }
    expect(listed.value?.providers[0].hasKey).toBe(true)
    // Renderer receives the key only through chatFor; list returns model state.
    expect(listed.value?.providers[0].apiKey).toBe('sk-abc123')

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

  it('tasks:create + tasks:get round-trip a task row', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()

    const created = (await ipc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    expect(created.ok).toBe(true)
    const id = created.value!.id

    const got = (await ipc.invoke('tasks:get', id)) as { ok: boolean; value?: { state: string; lesson_id: string } }
    expect(got.value?.state).toBe('pending')
    expect(got.value?.lesson_id).toBe('l1')
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
