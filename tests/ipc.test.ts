import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc } from '../src/main/ipc'
import { TaskRepository } from '../src/main/tasks/queue'
import type { FetchLike } from '../src/main/bilibili/client'
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
    // E1 (review): handlers verify the sender frame — pose as the app UI.
    return fn({ senderFrame: { url: 'file:///app/index.html' } }, ...args)
  }

  async invokeFrom(url: string, channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    return fn({ senderFrame: { url } }, ...args)
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

function makeCtx(bilibiliFetch?: FetchLike): AppContext {
  const ctx = createContext({
    libraryRoot: dir,
    userDataDir: join(dir, 'userdata'),
    cryptor: stubCryptor,
    ...(bilibiliFetch != null ? { bilibiliFetch } : {})
  })
  db = ctx.db
  return ctx
}

function fakeJsonResponse(body: unknown): {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  url: string
  json: () => Promise<unknown>
  text: () => Promise<string>
} {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    url: 'https://passport.bilibili.com/fake',
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

describe('ipc handlers over a real context', () => {
  it('registers the full API surface', () => {    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    for (const channel of [
      'school:login', 'school:logout', 'school:session', 'school:listCourses', 'school:addManualCourse', 'school:harvestLessons', 'school:netCheck',
      'bilibili:login', 'bilibili:loginStatus', 'bilibili:logout', 'bilibili:session',
      'providers:list', 'providers:save', 'providers:delete', 'providers:bind',
      'tasks:create',
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

  it('reports an expired session from the stored JWT exp claim (no network)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const { saveSession } = await import('../src/main/auth/session-store')
    const header = Buffer.from('{"alg":"HS256"}').toString('base64url')
    const expiredJwt = `${header}.${Buffer.from(JSON.stringify({ exp: 1_000_000 })).toString('base64url')}.sig`
    const validJwt = `${header}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`

    saveSession(
      join(dir, 'userdata'),
      { cookies: 'C=1', baseUrl: 'https://cvs.seu.edu.cn', savedAt: '2026-09-03T00:00:00Z', jwt: expiredJwt },
      stubCryptor
    )
    const expired = (await ipc.invoke('school:session')) as { value?: { state: string; expiresAt: number | null; savedAt: string | null } }
    expect(expired.value?.state).toBe('expired')
    expect(expired.value?.expiresAt).toBe(1_000_000_000)
    expect(expired.value?.savedAt).toBe('2026-09-03T00:00:00Z')

    saveSession(
      join(dir, 'userdata'),
      { cookies: 'C=1', baseUrl: 'https://cvs.seu.edu.cn', savedAt: '2026-09-03T00:00:00Z', jwt: validJwt },
      stubCryptor
    )
    const valid = (await ipc.invoke('school:session')) as { value?: { state: string } }
    expect(valid.value?.state).toBe('logged_in')
  })

  it('surfaces a failed embedded login through the one-shot loginOutcome channel', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)

    // Embedded login with no main window wired fails fast; the initiating
    // renderer dies mid-call in production, so the outcome must survive it.
    const login = (await ipc.invoke('school:login')) as { ok: boolean; error?: string }
    expect(login.ok).toBe(false)

    const first = (await ipc.invoke('school:session')) as { value?: { loginOutcome: { ok: boolean; message: string } | null } }
    expect(first.value?.loginOutcome?.ok).toBe(false)
    expect(first.value?.loginOutcome?.message).toContain('主窗口不可用')

    // One-shot: the second read reports nothing.
    const second = (await ipc.invoke('school:session')) as { value?: { loginOutcome: unknown } }
    expect(second.value?.loginOutcome).toBeNull()
  })

  it('school:netCheck classifies a fake-ip DNS takeover from injected lookups', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never, {
      netLookupOverride: async (host: string) => [{ address: host.startsWith('dncvsvod') ? '172.19.0.38' : '172.19.0.7' }]
    })
    const intercepted = (await ipc.invoke('school:netCheck')) as { value?: { intercepted: boolean; resolved: unknown[] } }
    expect(intercepted.value?.intercepted).toBe(true)
    expect(intercepted.value?.resolved).toHaveLength(2)
  })

  it('school:netCheck passes healthy public resolution through', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never, {
      netLookupOverride: async () => [{ address: '58.192.114.3' }]
    })
    const healthy = (await ipc.invoke('school:netCheck')) as { value?: { intercepted: boolean } }
    expect(healthy.value?.intercepted).toBe(false)
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

  it('providers:save with an empty key keeps the stored key on edit and rejects a new provider (review A6)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)

    const first = (await ipc.invoke('providers:save', { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-keep-me' })) as {
      ok: boolean
      value?: { id: string }
    }
    expect(first.ok).toBe(true)
    const providerId = first.value?.id ?? ''

    // Edit (rename) without re-typing the key: the stored key survives and
    // stays usable (capability resolution decrypts it successfully).
    const renamed = (await ipc.invoke('providers:save', { id: providerId, name: 'OpenAI 改', baseUrl: 'https://api.openai.com/v1/', apiKey: '' })) as {
      ok: boolean
    }
    expect(renamed.ok).toBe(true)
    const listed = (await ipc.invoke('providers:list')) as { value?: { providers: Array<{ name: string; hasKey: boolean }> } }
    expect(listed.value?.providers[0].name).toBe('OpenAI 改')
    expect(listed.value?.providers[0].hasKey).toBe(true)

    // A brand-new provider with no key is an explicit error, not a silent empty row.
    const fresh = (await ipc.invoke('providers:save', { name: 'NoKey Provider', baseUrl: 'https://api.nk/v1/', apiKey: '' })) as {
      ok: boolean
      error?: string
    }
    expect(fresh.ok).toBe(false)
    expect(fresh.error).toContain('API Key')
  })

  it('providers:bind validates capability names', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('providers:bind', 'voice', 'p1', 'm')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('capability')
  })

  it('refuses IPC from a non-app sender frame (review E1)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    // A school-platform page (or any hijacked page) loads WITH the preload
    // bridge attached — its JS must not reach the IPC surface.
    await expect(ipc.invokeFrom('https://cvs.seu.edu.cn/vod/play', 'settings:get')).rejects.toThrowError(/非法调用方/)
    await expect(ipc.invokeFrom('https://evil.example.com/x', 'providers:save')).rejects.toThrowError(/非法调用方/)
  })

  it('cancelling a pending task stores failed_stage=NULL and stays deletable (review D3)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
    const created = (await ipc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    const taskId = created.value!.id
    // The old code passed state='pending' as the failed stage → CHECK violation →
    // the task could be neither cancelled nor deleted.
    const cancelled = (await ipc.invoke('tasks:cancel', taskId)) as { ok: boolean }
    expect(cancelled.ok).toBe(true)
    const row = db.prepare('SELECT state, failed_stage, error_kind FROM tasks WHERE id = ?').get(taskId) as {
      state: string
      failed_stage: string | null
      error_kind: string | null
    }
    expect(row.state).toBe('failed')
    expect(row.failed_stage).toBeNull()
    expect(row.error_kind).toBe('cancelled')
    const removed = (await ipc.invoke('tasks:delete', taskId)) as { ok: boolean }
    expect(removed.ok).toBe(true)
  })

  it('tasks:runAsync enforces the queue invariants in main (review D1)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
    // Another task of the same lesson is already mid-pipeline.
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t-live', 'l1', 'transcribing', '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')").run()
    const created = (await ipc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    const second = created.value!.id
    const rejected = (await ipc.invoke('tasks:runAsync', second)) as { ok: boolean; error?: string }
    expect(rejected.ok).toBe(false)
    expect(rejected.error).toContain('该课时已有任务')

  })

  it('school:harvestLessons upserts the harvested catalog (V1.3)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, tecl_id, tecl_code, fetched_at) VALUES ('c1', '课程', '154717', 'TC1', '2026-08-30T00:00:00Z')").run()
    // A stale harvested row from a previous catalog (shifted indexes).
    db.prepare("INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES ('c1-L9', 'c1', '第10节课', '9', '2026-08-30T00:00:00Z')").run()

    // Stub the window-navigation primitive: the harvest returns three entries.
    ctx.harvestCoursePage = async () => ({
      teacherStreamUrl: 'https://dncvsvod/t.mp4?auth_key=x',
      screenStreamUrl: 'https://dncvsvod/s.mp4?auth_key=y',
      lessons: [
        { index: 0, title: '第1节课', ref: '0' },
        { index: 1, title: '第2节课', ref: '1' },
        { index: 2, title: '第3节课', ref: '2' }
      ]
    })

    const res = (await ipc.invoke('school:harvestLessons', 'c1')) as { ok: boolean; value?: { lessons: number } }
    expect(res.ok).toBe(true)
    expect(res.value?.lessons).toBe(3)

    const rows = db.prepare("SELECT id, title, play_ref FROM lessons WHERE course_id = 'c1' ORDER BY id").all() as Array<{ id: string; title: string; play_ref: string }>
    expect(rows).toEqual([
      { id: 'c1-L0', title: '第1节课', play_ref: '0' },
      { id: 'c1-L1', title: '第2节课', play_ref: '1' },
      { id: 'c1-L2', title: '第3节课', play_ref: '2' }
    ])
  })

  it('school:removeCourse deletes empty courses but protects processed ones (批4 C6)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-empty', '空课程', '2026-09-04T00:00:00Z')").run()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-data', '有数据课程', '2026-09-04T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('c-data-L0', 'c-data', '第1节课', '2026-09-04T00:00:00Z')").run()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'c-data-L0', 1, '{}', 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run()

    const okRes = (await ipc.invoke('school:removeCourse', 'c-empty')) as { ok: boolean; value?: boolean }
    expect(okRes.ok).toBe(true)
    expect((db.prepare("SELECT COUNT(*) AS n FROM courses WHERE id = 'c-empty'").get() as { n: number }).n).toBe(0)

    const refused = (await ipc.invoke('school:removeCourse', 'c-data')) as { ok: boolean; error?: string }
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('不允许删除')
    // The note survived the refused delete.
    expect((db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n).toBe(1)
  })

  it('school:harvestState tracks in-flight and outcome across the navigation (批C)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, tecl_id, tecl_code, fetched_at) VALUES ('c1', '课程', '154717', 'TC1', '2026-08-30T00:00:00Z')").run()

    // 成功路径：outcome 记录课时数，inflight 清空。
    ctx.harvestCoursePage = async () => ({
      teacherStreamUrl: 'https://dncvsvod/t.mp4?auth_key=x',
      lessons: [
        { index: 0, title: '第1节课', ref: '0' },
        { index: 1, title: '第2节课', ref: '1' }
      ]
    })
    await ipc.invoke('school:harvestLessons', 'c1')
    let state = (await ipc.invoke('school:harvestState')) as {
      ok: boolean
      value?: { inflight: string[]; outcome: { seq: number; courseId: string; ok: boolean; lessons: number; error?: string } | null }
    }
    expect(state.ok).toBe(true)
    expect(state.value?.inflight).toEqual([])
    expect(state.value?.outcome).toMatchObject({ courseId: 'c1', ok: true, lessons: 2 })

    // 失败路径：无 tecl 的课程 → outcome.ok=false 且带错误信息。
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-manual', '手动课程', '2026-08-30T00:00:00Z')").run()
    await ipc.invoke('school:harvestLessons', 'c-manual')
    state = (await ipc.invoke('school:harvestState')) as { ok: boolean; value?: { inflight: string[]; outcome: { seq: number; courseId: string; ok: boolean; lessons: number; error?: string } | null } }
    expect(state.value?.outcome).toMatchObject({ courseId: 'c-manual', ok: false })
    expect(String(state.value?.outcome?.error)).toContain('tecl')
    // seq 单调递增，渲染层靠它去重 toast。
    expect(state.value!.outcome!.seq).toBeGreaterThan(0)
  })

  it('school:harvestLessons rejects a course without tecl refs (refresh needed)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-manual', '手动课程', '2026-08-30T00:00:00Z')").run()
    const res = (await ipc.invoke('school:harvestLessons', 'c-manual')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('tecl')
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
      value?: Array<{ id: string; name: string; source?: string; lessons: Array<{ id: string; title: string; hasNote: boolean }> }>
    }
    expect(res.ok).toBe(true)
    expect(res.value).toHaveLength(1)
    const course = res.value![0]
    expect(course.name).toBe('高等数学')
    expect(course.source).toBe('seu')
    expect(course.lessons).toEqual([
      { id: 'l1', title: '第一讲', hasNote: true },
      { id: 'l2', title: '第二讲', hasNote: false }
    ])
  })

  it('school:courseTree orders bilibili lessons by bili_page and reports the source (009)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    // Insert pages out of numeric order: P2 before P10 before P1 — the
    // lexicographic id sort would get this wrong (P1 < P10 < P2).
    db.prepare(
      "INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('b1', '线性代数', 'bilibili', 'BV1GJ411x7h7', '2026-09-06T00:00:00Z')"
    ).run()
    for (const [page, cid, title] of [
      [2, '2002', 'P2 行列式'],
      [10, '2010', 'P10 特征值'],
      [1, '2001', 'P1 引言']
    ] as Array<[number, string, string]>) {
      db.prepare(
        "INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, fetched_at) VALUES (?, 'b1', ?, 'bilibili', ?, ?, '2026-09-06T00:00:00Z')"
      ).run(`b1-P${page}`, title, cid, page)
    }

    const res = (await ipc.invoke('school:courseTree')) as {
      ok: boolean
      value?: Array<{ id: string; source?: string; lessons: Array<{ id: string }> }>
    }
    expect(res.ok).toBe(true)
    expect(res.value![0].source).toBe('bilibili')
    expect(res.value![0].lessons.map((l) => l.id)).toEqual(['b1-P1', 'b1-P2', 'b1-P10'])
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

  it('tasks:list joins course/lesson names, delete removes row+evidence, clearFinished sweeps (M1-2)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c9', '网络信息编程', '2026-09-03T00:00:00Z')").run()
    db.prepare(
      "UPDATE courses SET teacher = '汪海', cour_times = '周一 第3-4节', classroom = '中山-312' WHERE id = 'c9'"
    ).run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l9', 'c9', '第五讲', '2026-09-03T00:00:00Z')").run()

    const created = (await ipc.invoke('tasks:create', 'l9')) as { value?: { id: string } }
    const taskId = created.value!.id
    db.prepare("UPDATE tasks SET state = 'failed', failed_stage = 'downloading_video', error_message = 'boom', error_kind = NULL WHERE id = ?").run(taskId)

    const listed = (await ipc.invoke('tasks:list')) as {
      value?: Array<{ course_name?: string; lesson_title?: string; teacher?: string | null; courTimes?: string | null; classroom?: string | null }>
    }
    expect(listed.value?.[0]?.course_name).toBe('网络信息编程')
    expect(listed.value?.[0]?.lesson_title).toBe('第五讲')
    // F4: teacher/meeting-times/classroom ride along for the history rows.
    expect(listed.value?.[0]?.teacher).toBe('汪海')
    expect(listed.value?.[0]?.courTimes).toBe('周一 第3-4节')
    expect(listed.value?.[0]?.classroom).toBe('中山-312')

    // A still-running (pending) task cannot be deleted — cancel first.
    const running = (await ipc.invoke('tasks:create', 'l9')) as { value?: { id: string } }
    const delRunning = (await ipc.invoke('tasks:delete', running.value!.id)) as { ok: boolean; error?: string }
    expect(delRunning.ok).toBe(false)
    expect(delRunning.error).toContain('取消')

    // delete: row + stage outputs gone.
    db.prepare('INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)').run(taskId, 'fetching_course', '{}')
    const del = (await ipc.invoke('tasks:delete', taskId)) as { ok: boolean }
    expect(del.ok).toBe(true)
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE id = ?').get(taskId) as { n: number }).n).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS n FROM task_stage_outputs WHERE task_id = ?').get(taskId) as { n: number }).n).toBe(0)

    // clearFinished sweeps every terminal row.
    db.prepare("UPDATE tasks SET state = 'succeeded' WHERE id = ?").run(running.value!.id)
    const cleared = (await ipc.invoke('tasks:clearFinished')) as { value?: { removed: number } }
    expect(cleared.value?.removed).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n).toBe(0)
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

  it('school:listCourses streams page progress and reports the platform boundary (B1/B2)', async () => {
    const ctx = makeCtx()
    const sent: Array<{ channel: string; payload: unknown }> = []
    ;(ctx as { school: unknown }).school = {
      listCoursesPaged: async (opts: { onProgress?: (p: { page: number; pageCount: number }) => void }) => {
        opts.onProgress?.({ page: 1, pageCount: 2 })
        opts.onProgress?.({ page: 2, pageCount: 2 })
        return {
          courses: [
            { id: 'c1', name: '课一', teacher: '甲', teclId: '1', teclCode: 'T1' },
            { id: 'c2', name: '课二' }
          ],
          platformPages: 648,
          fetchedPages: 2,
          platformTotal: 324000
        }
      }
    }
    registerIpc(ctx, ipc as never, {
      sender: { send: (channel, payload) => sent.push({ channel, payload }) }
    })

    const res = (await ipc.invoke('school:listCourses')) as {
      ok: boolean
      value?: { loaded: number; platformTotal: number; platformPages: number }
    }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ loaded: 2, platformTotal: 324000, platformPages: 648 })

    const rows = db.prepare('SELECT id, tecl_id, tecl_code FROM courses ORDER BY id').all() as Array<{ id: string; tecl_id: string | null }>
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2'])
    expect(rows[0].tecl_id).toBe('1')

    const progressEvents = sent.filter((s) => s.channel === 'school:refreshProgress')
    expect(progressEvents.map((s) => s.payload)).toEqual([
      { page: 1, pageCount: 2 },
      { page: 2, pageCount: 2 }
    ])
  })

  it('school:listCourses keeps prior metadata when a fetch record lacks it (C1 COALESCE)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare(
      "INSERT INTO courses (id, name, subj_code, classroom, cour_times, is_mine, fetched_at) VALUES ('c1', '课一', 'CS101', '中山-312', '周一 第3-4节', 1, '2026-09-03T00:00:00Z')"
    ).run()
    ;(ctx as { school: unknown }).school = {
      listCoursesPaged: async () => ({
        courses: [{ id: 'c1', name: '课一（改名）' }],
        platformPages: 1,
        fetchedPages: 1,
        platformTotal: 500
      })
    }
    const res = (await ipc.invoke('school:listCourses')) as { ok: boolean }
    expect(res.ok).toBe(true)
    const row = db.prepare('SELECT name, subj_code, classroom, cour_times, is_mine FROM courses WHERE id = ?').get('c1') as {
      name: string
      subj_code: string | null
      classroom: string | null
      is_mine: number
    }
    expect(row.name).toBe('课一（改名）')
    expect(row.subj_code).toBe('CS101')
    expect(row.classroom).toBe('中山-312')
    expect(row.is_mine).toBe(1)
  })

  it('school:setMine pins and unpins, and courseTree reports metadata + pin (C1/C2)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare(
      "INSERT INTO courses (id, name, subj_code, classroom, cour_times, fetched_at) VALUES ('c1', '课一', 'CS101', '中山-312', '周一 第3-4节', '2026-09-03T00:00:00Z')"
    ).run()

    const pinned = (await ipc.invoke('school:setMine', 'c1', true)) as { ok: boolean }
    expect(pinned.ok).toBe(true)
    const invalid = (await ipc.invoke('school:setMine', 'c1', 'yes')) as { ok: boolean; error?: string }
    expect(invalid.ok).toBe(false)

    const tree = (await ipc.invoke('school:courseTree')) as {
      value?: Array<{ id: string; subjCode?: string; classroom?: string; courTimes?: string; isMine?: boolean }>
    }
    expect(tree.value?.[0]).toMatchObject({ id: 'c1', subjCode: 'CS101', classroom: '中山-312', courTimes: '周一 第3-4节', isMine: true })

    await ipc.invoke('school:setMine', 'c1', false)
    const after = (await ipc.invoke('school:courseTree')) as { value?: Array<{ isMine?: boolean }> }
    expect(after.value?.[0].isMine).toBe(false)
  })

  it('courseTree aggregates extracted-study state per course (M1-4)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课一', '2026-09-03T00:00:00Z')").run()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c2', '课二', '2026-09-03T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第一讲', '2026-09-03T00:00:00Z')").run()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, '{}', 'p', 'm', '2026-09-03T01:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('tk1', 'l1', 'succeeded', '2026-09-03T01:00:00Z', '2026-09-03T01:30:00Z')"
    ).run()

    const tree = (await ipc.invoke('school:courseTree')) as {
      value?: Array<{ id: string; noteCount?: number; hasExtracted?: boolean; lastTaskAt?: string }>
    }
    const studied = tree.value?.find((c) => c.id === 'c1')
    const untouched = tree.value?.find((c) => c.id === 'c2')
    expect(studied).toMatchObject({ noteCount: 1, hasExtracted: true, lastTaskAt: '2026-09-03T01:30:00Z' })
    expect(untouched).toMatchObject({ noteCount: 0, hasExtracted: false })
  })
})

describe('registerIpc handle API (M1-3: close-window confirm)', () => {
  it('exposes queue-busy state and can cancel the running task', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
    const handle = registerIpc(ctx, ipc as never, {
      executorsOverride: () => ({
        fetching_course: (stageCtx) =>
          new Promise((resolve, reject) => {
            void resolve
            stageCtx.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          }),
        downloading_video: () => ({ status: 'ok' }),
        extracting_audio: () => ({ status: 'ok' }),
        transcribing: () => ({ status: 'ok' }),
        extracting_visuals: () => ({ status: 'ok' }),
        summarizing: () => ({ status: 'ok' })
      })
    })
    expect(handle.isTaskRunning()).toBe(false)

    const created = (await ipc.invoke('tasks:create', 'l1')) as { value?: { id: string } }
    await ipc.invoke('tasks:runAsync', created.value!.id)
    await vi.waitFor(() => expect(handle.isTaskRunning()).toBe(true))

    handle.cancelRunning()
    await vi.waitFor(() => {
      const row = db.prepare('SELECT state, error_kind FROM tasks WHERE id = ?').get(created.value!.id) as { state: string; error_kind: string | null }
      expect(row.state).toBe('failed')
      expect(row.error_kind).toBe('cancelled')
    })
    await vi.waitFor(() => expect(handle.isTaskRunning()).toBe(false))
  })
})

describe('bilibili qr login flow (plan 2026-09-06 M3)', () => {
  it('reports inactive before any login and logged_out session without a file', async () => {
    const ctx = makeCtx(async () => {
      throw new Error('no network expected')
    })
    registerIpc(ctx, ipc as never)
    const idle = (await ipc.invoke('bilibili:loginStatus')) as { ok: boolean; value?: { status: string } }
    expect(idle.value?.status).toBe('inactive')
    const session = (await ipc.invoke('bilibili:session')) as { ok: boolean; value?: { state: string; savedAt: string | null } }
    expect(session.value?.state).toBe('logged_out')
    expect(session.value?.savedAt).toBeNull()
  })

  it('walks waiting→scanned→confirmed, persists an encrypted session, logout clears', async () => {
    const pollPayloads = [
      { code: 0, data: { code: 86101, url: '', message: '' } },
      { code: 0, data: { code: 86090, url: '', message: '' } },
      {
        code: 0,
        data: { code: 0, url: 'https://passport.biligame.com/crossDomain?DedeUserID=9&SESSDATA=s1&bili_jct=t1&gourl=x', message: '' }
      }
    ]
    let pollCalls = 0
    const bilibiliFetch: FetchLike = async (url: string) => {
      if (url.includes('/qrcode/generate')) {
        return fakeJsonResponse({ code: 0, data: { url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=QR1', qrcode_key: 'QR1' } })
      }
      if (url.includes('/qrcode/poll')) return fakeJsonResponse(pollPayloads[Math.min(pollCalls++, pollPayloads.length - 1)])
      throw new Error(`no fixture route for ${url}`)
    }
    const ctx = makeCtx(bilibiliFetch)
    registerIpc(ctx, ipc as never)

    const login = (await ipc.invoke('bilibili:login')) as { ok: boolean; value?: { qrUrl: string } }
    expect(login.ok).toBe(true)
    expect(login.value?.qrUrl).toContain('qrcode_key=QR1')

    const waiting = (await ipc.invoke('bilibili:loginStatus')) as { value?: { status: string } }
    expect(waiting.value?.status).toBe('waiting')
    await new Promise((r) => setTimeout(r, 1050))
    const scanned = (await ipc.invoke('bilibili:loginStatus')) as { value?: { status: string } }
    expect(scanned.value?.status).toBe('scanned')
    await new Promise((r) => setTimeout(r, 1050))
    const confirmed = (await ipc.invoke('bilibili:loginStatus')) as { value?: { status: string } }
    expect(confirmed.value?.status).toBe('confirmed')

    // Encrypted at rest: the raw session file must not contain the plaintext
    // SESSDATA (stubCryptor XORs, so the ciphertext differs from plaintext).
    const raw = readFileSync(join(dir, 'userdata', 'bilibili-session', 'session.bin'), 'utf8')
    expect(raw).not.toContain('SESSDATA=s1')
    const session = (await ipc.invoke('bilibili:session')) as { value?: { state: string; savedAt: string | null } }
    expect(session.value?.state).toBe('logged_in')
    expect(session.value?.savedAt).not.toBeNull()

    const logout = (await ipc.invoke('bilibili:logout')) as { value?: { state: string } }
    expect(logout.value?.state).toBe('logged_out')
    const after = (await ipc.invoke('bilibili:session')) as { value?: { state: string } }
    expect(after.value?.state).toBe('logged_out')
    const next = (await ipc.invoke('bilibili:loginStatus')) as { value?: { status: string } }
    expect(next.value?.status).toBe('inactive')
  })

  it('refuses a non-app sender frame (E1 sender validation covers bilibili channels)', async () => {
    const ctx = makeCtx(async () => {
      throw new Error('no network expected')
    })
    registerIpc(ctx, ipc as never)
    await expect(ipc.invokeFrom('https://cvs.seu.edu.cn/evil', 'bilibili:login')).rejects.toThrowError()
  })
})
