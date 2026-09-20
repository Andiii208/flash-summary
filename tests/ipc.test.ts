import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, BILIBILI_POLL_CACHE_MS, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin, assertSafeId } from '../src/main/ipc'
import { TaskRepository } from '../src/main/tasks/queue'
import { attachmentsPath } from '../src/main/library/paths'
import type { FetchLike } from '../src/main/bilibili/client'
import type { Stage } from '../src/main/tasks/stages'
import type { StageExecutor } from '../src/main/tasks/queue'
import type { Cryptor } from '../src/main/auth/session-crypto'
import { waitFor } from './helpers/wait-for'

// 批1（契约有意变更）：assertAppSender 从「任意 file:// 放行」收窄为「只认
// 启动时注入的应用 renderer URL」。这里 mock electron 平台层（与
// ipc-settings/ipc-feedback 同款）；app 做成可变对象，供「dev 前缀仅未打包
// 放行」用例翻转 isPackaged。
const electronApp = vi.hoisted(() => ({ isPackaged: false, getVersion: () => '0.0.0-test' }))
vi.mock('electron', () => ({
  ipcMain: undefined,
  dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })), showOpenDialog: vi.fn(async () => ({ canceled: true })) },
  shell: { openPath: vi.fn(async () => '') },
  BrowserWindow: { getFocusedWindow: () => null },
  app: electronApp,
  WebContents: undefined
}))

// FakeIpc 伪装的调用方 URL 必须经注入才算数（与 tests/ipc-settings 等同一契约）。
setAppRendererOrigin('file:///app/index.html')

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
    // 批1（契约有意变更）：这个 URL 现在必须与 setAppRendererOrigin 注入的
    // 应用 renderer URL 完全相等，不再因为是 file:// 就放行。
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
  arrayBuffer: () => Promise<ArrayBuffer>
} {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    url: 'https://passport.bilibili.com/fake',
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0)
  }
}

describe('ipc handlers over a real context', () => {
  it('registers the full API surface', () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    for (const channel of [
      'school:login', 'school:logout', 'school:session', 'school:listCourses', 'school:addManualCourse', 'school:harvestLessons', 'school:netCheck',
      'bilibili:login', 'bilibili:loginStatus', 'bilibili:logout', 'bilibili:session',
      'providers:list', 'providers:save', 'providers:delete', 'providers:bind', 'providers:unbind',
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

  it('school:logout failures come back as the err envelope, not a raw rejection (health audit 2026-09-12)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    // Inject a logout failure — every other async handler already guarantees
    // the renderer an ApiResult; logout was the last one that could leak a
    // raw exception across the bridge.
    ctx.logout = async () => {
      throw new Error('登出失败注入')
    }
    const res = (await ipc.invoke('school:logout')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('登出失败注入')
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

  // 批4 (plan 2026-09-20, P14): 取消勾选的能力随保存解绑——渲染层此前只能绑不能解。
  it('批4 (P14): providers:unbind 删掉该能力的绑定行，非法 capability 拒绝', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const saved = (await ipc.invoke('providers:save', { name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: 'sk-1' })) as {
      value?: { id: string }
    }
    const providerId = saved.value!.id
    expect((await ipc.invoke('providers:bind', 'asr', providerId, 'mimo-v2.5-asr')) as { ok: boolean }).toMatchObject({ ok: true })
    expect((await ipc.invoke('providers:bind', 'multimodal', providerId, 'mimo-v2.5')) as { ok: boolean }).toMatchObject({ ok: true })

    const released = (await ipc.invoke('providers:unbind', 'asr')) as { ok: boolean }
    expect(released.ok).toBe(true)
    const listed = (await ipc.invoke('providers:list')) as { value?: { bindings: Array<{ capability: string; providerId: string; model: string }> } }
    expect(listed.value?.bindings).toEqual([{ capability: 'multimodal', providerId, model: 'mimo-v2.5' }])

    // 与 providers:bind 同一份白名单（smoke 也有同款探针）。
    const bogus = (await ipc.invoke('providers:unbind', 'voice')) as { ok: boolean; error?: string }
    expect(bogus.ok).toBe(false)
    expect(bogus.error).toContain('capability')
    expect(((await ipc.invoke('providers:list')) as { value?: { bindings: unknown[] } }).value?.bindings).toHaveLength(1)
  })

  // P25 (2026-09-21): 能力面收敛为两项——「文本问答」不再是能力，桥面拒绝写入；
  // 追问链路改走多模态绑定，老库里遗留的 text 行不再劫持 Q&A。
  it('P25: providers:bind 拒绝已删除的 text 能力，追问能力恒为 multimodal', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const saved = (await ipc.invoke('providers:save', { name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: 'sk-1' })) as {
      value?: { id: string }
    }
    const providerId = saved.value!.id

    const rejected = (await ipc.invoke('providers:bind', 'text', providerId, 'qwen2.5')) as { ok: boolean; error?: string }
    expect(rejected.ok).toBe(false)
    expect(rejected.error).toContain('capability')

    // 模拟老库遗留（migration 013 之前的形态）：直接插一行 text 绑定。
    ctx.db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('text', ?, 'qwen2.5')").run(providerId)
    expect(ctx.qaCapability()).toBe('multimodal')

    // 多模态绑定存在时，追问取用的就是它（不再是 text）。
    expect((await ipc.invoke('providers:bind', 'multimodal', providerId, 'mimo-v2.5')) as { ok: boolean }).toMatchObject({ ok: true })
    expect(ctx.providers().bindings.find((b) => b.capability === ctx.qaCapability())?.model).toBe('mimo-v2.5')
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

  // 批1 (plan 2026-09-20, P20/D1 推荐侧): a harvest must never destroy work.
  // The six dependency tables mirror 001_initial.ts's ON DELETE CASCADE list —
  // if any of them has a row, the lesson is frozen against the harvest's DELETE.
  const DEPENDENCY_ROWS: Array<{ lessonId: string; label: string; sql: string }> = [
    {
      lessonId: 'c1-L3',
      label: 'notes',
      sql: "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n3', 'c1-L3', 1, '{}', 'p', 'm', '2026-08-30T00:00:00Z')"
    },
    {
      lessonId: 'c1-L4',
      label: 'transcripts',
      sql: "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('c1-L4', '[]', 'p', 'm', '2026-08-30T00:00:00Z')"
    },
    {
      lessonId: 'c1-L5',
      label: 'keyframes',
      sql: "INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES ('k5', 'c1-L5', 0, 'x.jpg', 'h', '2026-08-30T00:00:00Z')"
    },
    {
      lessonId: 'c1-L6',
      label: 'ppt_pages',
      sql: "INSERT INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES ('p6', 'c1-L6', 0, 'x.png', '2026-08-30T00:00:00Z')"
    },
    {
      lessonId: 'c1-L7',
      label: 'tasks',
      sql: "INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t7', 'c1-L7', 'succeeded', '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')"
    },
    {
      lessonId: 'c1-L8',
      label: 'qa',
      sql: "INSERT INTO qa (id, lesson_id, question, answer, created_at) VALUES ('q8', 'c1-L8', '问', '答', '2026-08-30T00:00:00Z')"
    }
  ]

  function seedHarvestCourse(): AppContext {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, tecl_id, tecl_code, fetched_at) VALUES ('c1', '课程', '154717', 'TC1', '2026-08-30T00:00:00Z')").run()
    return ctx
  }

  function lessonIds(): string[] {
    return (db.prepare("SELECT id FROM lessons WHERE course_id = 'c1' ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id)
  }

  function logText(): string {
    const logsDir = join(dir, 'userdata', 'logs')
    return readdirSync(logsDir)
      .map((f) => readFileSync(join(logsDir, f), 'utf8'))
      .join('\n')
  }

  it('批1 (P20): 六类产物任一存在即受保护——重收割不再删掉这些课时', async () => {
    const ctx = seedHarvestCourse()
    for (const dep of DEPENDENCY_ROWS) {
      db.prepare("INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES (?, 'c1', ?, ?, '2026-08-30T00:00:00Z')").run(
        dep.lessonId,
        `旧 ${dep.label}`,
        dep.lessonId.slice(-1)
      )
      db.prepare(dep.sql).run()
    }
    // 无任何依赖行的旧课时——它才是本次收割该清理的对象。
    db.prepare("INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES ('c1-L9', 'c1', '第10节课', '9', '2026-08-30T00:00:00Z')").run()

    ctx.harvestCoursePage = async () => ({ lessons: [{ index: 0, title: '第1节课', ref: '0' }] })
    const res = (await ipc.invoke('school:harvestLessons', 'c1')) as { ok: boolean }
    expect(res.ok).toBe(true)

    // 六个带产物的旧课时全部留下，只有真空行 c1-L9 被清理。
    expect(lessonIds()).toEqual(['c1-L0', 'c1-L3', 'c1-L4', 'c1-L5', 'c1-L6', 'c1-L7', 'c1-L8'])
    // 级联没被触发：笔记仍在它自己的行上。
    expect((db.prepare("SELECT COUNT(*) AS n FROM notes WHERE lesson_id = 'c1-L3'").get() as { n: number }).n).toBe(1)
    // 日志给出三个数：本次真删了几行、几行因有产物被保住。
    const logs = logText()
    expect(logs).toContain('harvestLessons: course=c1 entries=1 dropped=1 keptProtected=6')
  })

  it('批1 (P20): 漂移冻结——有产出的课时 title/play_ref 不被改写，无产物行照常更新', async () => {
    const ctx = seedHarvestCourse()
    db.prepare("INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES ('c1-L3', 'c1', '第4节课', '3', '2026-08-30T00:00:00Z')").run()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n3', 'c1-L3', 1, '{}', 'p', 'm', '2026-08-30T00:00:00Z')"
    ).run()
    db.prepare("INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES ('c1-L4', 'c1', '第5节课', '4', '2026-08-30T00:00:00Z')").run()

    // 平台把序号挪了一格：本次收割说 L3 是「第5节课」、L4 是「第6节课」。
    ctx.harvestCoursePage = async () => ({
      lessons: [
        { index: 3, title: '第5节课', ref: '4' },
        { index: 4, title: '第6节课', ref: '5' }
      ]
    })
    const res = (await ipc.invoke('school:harvestLessons', 'c1')) as { ok: boolean }
    expect(res.ok).toBe(true)

    const rows = db.prepare("SELECT id, title, play_ref FROM lessons WHERE course_id = 'c1' ORDER BY id").all() as Array<{
      id: string
      title: string
      play_ref: string | null
    }>
    // 带笔记的行冻结在原名上（笔记还挂着，行名不能变成另一节课）；
    // 空行照常跟随平台更新。
    expect(rows).toEqual([
      { id: 'c1-L3', title: '第4节课', play_ref: '3' },
      { id: 'c1-L4', title: '第6节课', play_ref: '5' }
    ])
    // 漂移不是静默的——日志留一条，且这条记录挂在受保护的行上。
    expect(logText()).toContain('harvestLessons drift (kept): c1-L3')
  })

  it('批1 (P20): 空收割仍不删任何行（现状钉住）', async () => {
    const ctx = seedHarvestCourse()
    db.prepare("INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES ('c1-L9', 'c1', '第10节课', '9', '2026-08-30T00:00:00Z')").run()

    ctx.harvestCoursePage = async () => ({ lessons: [] })
    const res = (await ipc.invoke('school:harvestLessons', 'c1')) as { ok: boolean; value?: { lessons: number } }
    expect(res.ok).toBe(true)
    expect(res.value?.lessons).toBe(0)
    expect(lessonIds()).toEqual(['c1-L9'])
    expect(logText()).toContain('harvestLessons: course=c1 entries=0 dropped=0 keptProtected=0')
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

  // 批6 (plan 2026-09-19, D8 推荐侧): the delete guard only blocks LIVE work —
  // running/queued rows, or any row whose task cache still occupies disk
  // (resumable artifacts). failed/cancelled rows with no cache are terminal
  // debris and must not keep a mis-added course undeletable forever.
  it('批6 (D8): removeCourse no longer blocked by a failed task without cache — and lesson attachments are GCed', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-failed', '失败课程', '2026-09-19T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('c-failed-L0', 'c-failed', '第1节课', '2026-09-19T00:00:00Z')").run()
    db.prepare(
      "INSERT INTO tasks (id, lesson_id, state, failed_stage, error_message, created_at, updated_at) VALUES ('tf1', 'c-failed-L0', 'failed', 'transcribing', '任务已取消', '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z')"
    ).run()
    // Attachments on disk for the lesson — the unbounded growth 批6 closes.
    const lessonAttachments = join(attachmentsPath(dir), 'c-failed-L0')
    mkdirSync(join(lessonAttachments, 'keyframes'), { recursive: true })
    writeFileSync(join(lessonAttachments, 'keyframes', 'kf-0000-0s.jpg'), 'frame')

    const res = (await ipc.invoke('school:removeCourse', 'c-failed')) as { ok: boolean; value?: boolean }
    expect(res.ok).toBe(true)
    expect((db.prepare("SELECT COUNT(*) AS n FROM courses WHERE id = 'c-failed'").get() as { n: number }).n).toBe(0)
    // The library rows cascade; the disk evidence goes with them.
    expect(existsSync(lessonAttachments)).toBe(false)
  })

  it('批6 (D8): a failed task whose cache still occupies disk blocks removal', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-cached', '残留缓存课程', '2026-09-19T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('c-cached-L0', 'c-cached', '第1节课', '2026-09-19T00:00:00Z')").run()
    db.prepare(
      "INSERT INTO tasks (id, lesson_id, state, failed_stage, error_message, created_at, updated_at) VALUES ('tc1', 'c-cached-L0', 'failed', 'downloading_video', '网络中断', '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z')"
    ).run()
    const cacheDir = join(dir, 'cache', 'tc1')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'teacher.ts'), 'partial-stream')

    const res = (await ipc.invoke('school:removeCourse', 'c-cached')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('不允许删除')
    expect((db.prepare("SELECT COUNT(*) AS n FROM courses WHERE id = 'c-cached'").get() as { n: number }).n).toBe(1)
    expect(existsSync(join(attachmentsPath(dir), 'c-cached-L0'))).toBe(false)
  })

  it('批6 (D8): a queued/running task blocks removal even with no cache on disk', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-live', '在跑课程', '2026-09-19T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('c-live-L0', 'c-live', '第1节课', '2026-09-19T00:00:00Z')").run()
    db.prepare(
      "INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('tl1', 'c-live-L0', 'pending', '2026-09-19T00:00:00Z', '2026-09-19T00:00:00Z')"
    ).run()

    const res = (await ipc.invoke('school:removeCourse', 'c-live')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('不允许删除')
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
    // 批2 (plan 2026-09-20, P7): 取到笔记时返回 { note, transcriptHitRate }——
    // 无笔记仍是 ok(null)（上面的早退不变），有笔记时多带一条 main 侧算的命中率。
    const latest = (await ipc.invoke('notes:latest', 'l1')) as {
      ok: boolean
      value?: { note: { overview: string }; transcriptHitRate: { hits: number; total: number } | null }
    }
    expect(latest.value?.note?.overview).toBe('概览')
    // 本用例没有转写 → 无从判断，命中率为 null（不是 0/0 的假指标）。
    expect(latest.value?.transcriptHitRate).toBeNull()
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

    // Wait for the background pipeline to land: the task row reaching a
    // terminal state is the one condition the assertions below depend on
    // (was: a fixed 250ms sleep sized against "6 stub stages × 10ms").
    await waitFor(() => {
      const row = new TaskRepository(db).get(taskId)
      expect(row?.state).toBe('succeeded')
    })

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
    // Wait for the failed progress event to reach the recorder instead of
    // guessing a duration for the stub to fail (was: 120ms).
    await waitFor(() => {
      const failed = recIpc.sent.find((s) => s.channel === 'tasks:progress' && (s.payload as { state: string }).state === 'failed')
      expect(failed).toBeDefined()
    })

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
    // Wait for the first run to land in failed before resuming (was: 100ms).
    await waitFor(() => expect(new TaskRepository(db).get(taskId)?.state).toBe('failed'))

    // Same channel, same task: firstStageFor restarts it at the failed stage.
    await recIpc.invoke('tasks:runAsync', taskId)
    // Wait for the resumed run to finish before snapshotting the event list
    // (was: 150ms) — otherwise the trailing assertions race the queue.
    await waitFor(() => expect(new TaskRepository(db).get(taskId)?.state).toBe('succeeded'))

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
    // created_at is ms-precision and tasks:list orders by it: let the clock
    // move past task a before creating b so "newest first" has a real
    // tiebreak, instead of hoping two creates land in different milliseconds
    // (was: a 5ms sleep between the two creates).
    await waitFor(() => {
      const row = db.prepare('SELECT created_at FROM tasks WHERE id = ?').get(a.value!.id) as { created_at: string }
      expect(Date.now()).toBeGreaterThan(Date.parse(row.created_at))
    })
    const b = (await ipc.invoke('tasks:create', 'l2')) as { ok: boolean; value?: { id: string } }

    // 批C: 列表返回 { items, total, limit }——total 让 UI 能如实说「共 N 条」。
    const all = (await ipc.invoke('tasks:list')) as { ok: boolean; value?: { items: Array<{ id: string }>; total: number; limit: number } }
    expect(all.value?.items.map((t) => t.id)).toEqual([b.value!.id, a.value!.id])
    expect(all.value?.total).toBe(2)
    expect(all.value?.limit).toBe(50)

    const onlyL2 = (await ipc.invoke('tasks:list', 'l2')) as { ok: boolean; value?: { items: Array<{ id: string }>; total: number } }
    expect(onlyL2.value?.items.map((t) => t.id)).toEqual([b.value!.id])
    // total 是**过滤后**的总数，不是全表。
    expect(onlyL2.value?.total).toBe(1)
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
      value?: { items: Array<{ course_name?: string; lesson_title?: string; teacher?: string | null; courTimes?: string | null; classroom?: string | null }> }
    }
    expect(listed.value?.items[0]?.course_name).toBe('网络信息编程')
    expect(listed.value?.items[0]?.lesson_title).toBe('第五讲')
    // F4: teacher/meeting-times/classroom ride along for the history rows.
    expect(listed.value?.items[0]?.teacher).toBe('汪海')
    expect(listed.value?.items[0]?.courTimes).toBe('周一 第3-4节')
    expect(listed.value?.items[0]?.classroom).toBe('中山-312')

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

    // Health audit 2026-09-12: the id is joined into an rmSync path — reject
    // anything outside the generator's alphabet before it ever gets there.
    for (const hostile of ['../escape', 'a/b', 'id with space', '.']) {
      const rejected = (await ipc.invoke('tasks:delete', hostile)) as { ok: boolean; error?: string }
      expect(rejected.ok, hostile).toBe(false)
      expect(rejected.error).toContain('格式')
    }

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
    await waitFor(() => expect(handle.isTaskRunning()).toBe(true))

    handle.cancelRunning()
    await waitFor(() => {
      const row = db.prepare('SELECT state, error_kind FROM tasks WHERE id = ?').get(created.value!.id) as { state: string; error_kind: string | null }
      expect(row.state).toBe('failed')
      expect(row.error_kind).toBe('cancelled')
    })
    await waitFor(() => expect(handle.isTaskRunning()).toBe(false))
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

    // 等状态而不是等时间：loginStatus 在一个轮询缓存窗口内返回缓存旧状态，过窗
    // 才推进一档，所以每档的等待预算必须大于一个缓存窗口（余量不再拍 1050 这种
    // 死数字——缓存窗口从 app-context 导入）。两档各自独立推进，不互相赶时间。
    const qrTransitionBudgetMs = BILIBILI_POLL_CACHE_MS + 4000
    const waiting = (await ipc.invoke('bilibili:loginStatus')) as { value?: { status: string } }
    expect(waiting.value?.status).toBe('waiting')
    await waitFor(async () => {
      const next = (await ipc.invoke('bilibili:loginStatus')) as { value?: { status: string } }
      expect(next.value?.status).toBe('scanned')
    }, qrTransitionBudgetMs)
    await waitFor(async () => {
      const next = (await ipc.invoke('bilibili:loginStatus')) as { value?: { status: string } }
      expect(next.value?.status).toBe('confirmed')
    }, qrTransitionBudgetMs)

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

describe('bilibili resolve/import (plan 2026-09-06 M4)', () => {
  it('bilibili:resolve parses a BV link into an import preview', async () => {
    let calls = 0
    const bilibiliFetch: FetchLike = async (url) => {
      calls++
      if (url.includes('/x/web-interface/view?bvid=BV1GJ411x7h7')) {
        return fakeJsonResponse({
          code: 0,
          data: {
            bvid: 'BV1GJ411x7h7',
            title: '视频标题',
            pic: 'https://i0.hdslb.com/c.jpg',
            cid: 1,
            duration: 10,
            rights: { is_ugc_pay: 0 },
            owner: { mid: 5 },
            pages: [
              { page: 1, cid: 1, part: 'P1', duration: 10 },
              { page: 2, cid: 2, part: 'P2', duration: 20 }
            ]
          }
        })
      }
      if (url === 'https://i0.hdslb.com/c.jpg') {
        return {
          ...fakeJsonResponse(null),
          headers: { get: (n: string) => (n === 'content-type' ? 'image/jpeg' : null) },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
        }
      }
      throw new Error(`no fixture route for ${url}`)
    }
    const ctx = makeCtx(bilibiliFetch)
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('bilibili:resolve', 'https://www.bilibili.com/video/BV1GJ411x7h7?p=2')) as {
      ok: boolean
      value?: { bvid: string; requestedPage: number | null; title: string; coverDataUrl: string | null; pages: Array<{ page: number }> }
    }
    expect(res.ok).toBe(true)
    expect(res.value?.bvid).toBe('BV1GJ411x7h7')
    expect(res.value?.requestedPage).toBe(2)
    expect(res.value?.pages).toHaveLength(2)
    // Cover rides through main as a data URL (renderer CSP is img-src 'self' data:).
    expect(res.value?.coverDataUrl).toContain('data:image/jpeg;base64,')
    void calls
  })

  it('bilibili:import upserts course+lessons with source columns and rejects paid videos', async () => {
    const viewPayload = {
      code: 0,
      data: {
        bvid: 'BV1GJ411x7h7',
        title: '视频标题',
        cid: 1,
        duration: 10,
        rights: { is_ugc_pay: 0 },
        owner: { mid: 5 },
        pages: [
          { page: 1, cid: 11, part: 'P1', duration: 10 },
          { page: 2, cid: 22, part: 'P2', duration: 20 }
        ]
      }
    }
    let paid = false
    const bilibiliFetch: FetchLike = async (url) => {
      if (url.includes('/x/web-interface/view?bvid=BV1GJ411x7h7')) {
        return fakeJsonResponse(paid ? { ...viewPayload, data: { ...viewPayload.data, rights: { is_ugc_pay: 1 } } } : viewPayload)
      }
      throw new Error(`no fixture route for ${url}`)
    }
    const ctx = makeCtx(bilibiliFetch)
    registerIpc(ctx, ipc as never)

    const res = (await ipc.invoke('bilibili:import', { bvid: 'BV1GJ411x7h7', pages: [2, 1] })) as {
      ok: boolean
      value?: { courseId: string; lessonIds: string[] }
    }
    expect(res.ok).toBe(true)
    expect(res.value?.courseId).toBe('bili-BV1GJ411x7h7')
    expect(res.value?.lessonIds).toEqual(['bili-BV1GJ411x7h7-P2', 'bili-BV1GJ411x7h7-P1'])
    const rows = db.prepare('SELECT id, source, bili_cid, bili_page FROM lessons ORDER BY bili_page').all() as Array<{ id: string; source: string; bili_cid: string; bili_page: number }>
    expect(rows).toEqual([
      { id: 'bili-BV1GJ411x7h7-P1', source: 'bilibili', bili_cid: '11', bili_page: 1 },
      { id: 'bili-BV1GJ411x7h7-P2', source: 'bilibili', bili_cid: '22', bili_page: 2 }
    ])
    const course = db.prepare('SELECT source, bili_bvid FROM courses WHERE id = ?').get('bili-BV1GJ411x7h7') as { source: string; bili_bvid: string }
    expect(course).toEqual({ source: 'bilibili', bili_bvid: 'BV1GJ411x7h7' })

    // Re-import is idempotent (upsert, no duplicate rows).
    const again = (await ipc.invoke('bilibili:import', { bvid: 'BV1GJ411x7h7', pages: [1] })) as { ok: boolean }
    expect(again.ok).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM lessons').get()).toEqual({ n: 2 })

    // Paid videos are refused at resolve/import time.
    paid = true
    const paidRes = (await ipc.invoke('bilibili:import', { bvid: 'BV1GJ411x7h7', pages: [1] })) as { ok: boolean; error?: string }
    expect(paidRes.ok).toBe(false)
    expect(paidRes.error).toContain('付费')
  })
})

describe('bilibili course auto-chain over ipc (usability 2026-09-07)', () => {
  const allOkExecutors: Record<Stage, StageExecutor> = {
    fetching_course: () => ({ status: 'ok' }),
    downloading_video: () => ({ status: 'ok' }),
    extracting_audio: () => ({ status: 'ok' }),
    transcribing: () => ({ status: 'ok' }),
    extracting_visuals: () => ({ status: 'ok' }),
    summarizing: () => ({ status: 'ok' })
  }

  it('P1 success auto-starts the pending P2 of the same bilibili course', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('b1', '课', 'bilibili', 'BV1X', '2026-09-07T00:00:00Z')").run()
    for (const [page, cid] of [[1, '11'], [2, '22'], [3, '33']] as Array<[number, string]>) {
      db.prepare(
        "INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, fetched_at) VALUES (?, 'b1', ?, 'bilibili', ?, ?, '2026-09-07T00:00:00Z')"
      ).run(`b1-P${page}`, `P${page}`, cid, page)
    }
    registerIpc(ctx, ipc as never, { executorsOverride: () => allOkExecutors })
    const t1 = (await ipc.invoke('tasks:create', 'b1-P1')) as { value?: { id: string } }
    const t2 = (await ipc.invoke('tasks:create', 'b1-P2')) as { value?: { id: string } }
    const t3 = (await ipc.invoke('tasks:create', 'b1-P3')) as { value?: { id: string } }

    await ipc.invoke('tasks:runAsync', t1.value!.id)
    // The chain walks P2 then P3 without any further renderer action.
    await waitFor(() => {
      const p3 = db.prepare('SELECT state FROM tasks WHERE id = ?').get(t3.value!.id) as { state: string }
      expect(p3.state).toBe('succeeded')
    })
    for (const id of [t1.value!.id, t2.value!.id, t3.value!.id]) {
      const row = db.prepare('SELECT state FROM tasks WHERE id = ?').get(id) as { state: string }
      expect(row.state).toBe('succeeded')
    }
  })

  it('a failed P stops the chain; a seu course never chains', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课', '2026-09-07T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-07T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '课时二', '2026-09-07T00:00:00Z')").run()
    registerIpc(ctx, ipc as never, { executorsOverride: () => allOkExecutors })
    const t1 = (await ipc.invoke('tasks:create', 'l1')) as { value?: { id: string } }
    const t2 = (await ipc.invoke('tasks:create', 'l2')) as { value?: { id: string } }
    await ipc.invoke('tasks:runAsync', t1.value!.id)
    // 续链与否在 t1 跑完的那一刻就决定了：等 t1 落到终态，而不是拍一个
    // 「肯定跑完了」的固定 300ms。
    await waitFor(() => {
      const row = db.prepare('SELECT state FROM tasks WHERE id = ?').get(t1.value!.id) as { state: string }
      expect(row.state).toBe('succeeded')
    })
    // SEU course: l2 stays pending — no auto-chain outside bilibili.
    const l2 = db.prepare('SELECT state FROM tasks WHERE id = ?').get(t2.value!.id) as { state: string }
    expect(l2.state).toBe('pending')
  })
})

describe('assertAppSender — 批1 调用方边界（契约有意变更：不再放行任意 file://）', () => {
  const APP_RENDERER_URL = 'file:///E:/SEU%20summary/out/renderer/index.html'

  afterEach(() => {
    // 还原 FakeIpc 的伪装身份，避免影响本文件其余用例。
    setAppRendererOrigin('file:///app/index.html')
    delete process.env.ELECTRON_RENDERER_URL
    electronApp.isPackaged = false
  })

  it('rejects a foreign file:// page (the old code allowed any file://)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    await expect(ipc.invokeFrom('file:///C:/temp/evil.html', 'settings:get')).rejects.toThrowError(/非法调用方/)
  })

  it('accepts exactly the renderer URL injected at startup', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    setAppRendererOrigin(APP_RENDERER_URL)
    const res = (await ipc.invokeFrom(APP_RENDERER_URL, 'settings:get')) as { ok: boolean }
    expect(res.ok).toBe(true)
    // A sibling file in the same directory still fails — exact match, not prefix.
    await expect(ipc.invokeFrom('file:///E:/SEU%20summary/out/renderer/other.html', 'settings:get')).rejects.toThrowError(
      /非法调用方/
    )
  })

  it('accepts the dev-server prefix only when unpackaged', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
    electronApp.isPackaged = false
    const ok = (await ipc.invokeFrom('http://localhost:5173/', 'settings:get')) as { ok: boolean }
    expect(ok.ok).toBe(true)
    electronApp.isPackaged = true
    await expect(ipc.invokeFrom('http://localhost:5173/', 'settings:get')).rejects.toThrowError(/非法调用方/)
  })

  it('rejects https callers', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    await expect(ipc.invokeFrom('https://evil.example/x', 'providers:list')).rejects.toThrowError(/非法调用方/)
  })
})

describe('assertSafeId — 批2 id 入盘校验', () => {
  it('accepts the generator alphabet and rejects traversal, absolute paths, spaces and overlong values', () => {
    expect(assertSafeId('course-01', 'courseId')).toBe('course-01')
    expect(assertSafeId('c1-L12', 'lessonId')).toBe('c1-L12')
    expect(assertSafeId('bili-BV1GJ411x7h7-P1', 'lessonId')).toBe('bili-BV1GJ411x7h7-P1')
    expect(assertSafeId('a.b_c-d', 'id')).toBe('a.b_c-d')
    for (const bad of ['..', '.', '../escape', '/abs', 'C:\\win', 'a b', 'a/b', 'a'.repeat(129), '', '课程一']) {
      expect(() => assertSafeId(bad, 'id'), bad).toThrow(/(格式|non-empty)/)
    }
  })

  it('rejects path-shaped ids at the handler entries (addManualCourse / tasks:create)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const badCourse = await ipc.invoke('school:addManualCourse', '../escape', 'L1') as { ok: boolean; error?: string }
    expect(badCourse.ok).toBe(false)
    // 终审修复波: 报错文案全中文——「courseId 格式不合法」→「课程 ID 格式不合法」。
    expect(badCourse.error).toContain('课程 ID')
    const badLesson = await ipc.invoke('school:addManualCourse', 'C1', 'L1/..') as { ok: boolean; error?: string }
    expect(badLesson.ok).toBe(false)
    expect(badLesson.error).toContain('课时 ID')
    const longLesson = await ipc.invoke('tasks:create', 'a'.repeat(200)) as { ok: boolean; error?: string }
    expect(longLesson.ok).toBe(false)
    expect(longLesson.error).toContain('课时 ID')
  })

  it('keeps the tasks:delete hostiles rejected (guard moved into assertSafeId)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    for (const hostile of ['../escape', 'a/b', 'id with space', '.']) {
      const rejected = (await ipc.invoke('tasks:delete', hostile)) as { ok: boolean; error?: string }
      expect(rejected.ok, hostile).toBe(false)
      expect(rejected.error, hostile).toContain('格式')
    }
  })
})
