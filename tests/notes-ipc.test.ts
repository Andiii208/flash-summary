import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'

vi.mock('electron', () => ({
  ipcMain: undefined,
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
  BrowserWindow: { getFocusedWindow: () => null },
  WebContents: undefined
}))

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

const VALID_NOTE = JSON.stringify({
  overview: '本讲概览',
  knowledgeTree: { title: 'root', children: [{ title: 'child', children: [] }] },
  timeline: [{ at: 120, title: 't', detail: 'd', evidence: [{ kind: 'keyframe', ref: 'kf:kf-1' }] }],
  methodology: '方法',
  examCues: [],
  questionsAndGaps: []
})

let db: Db
let dir: string
let ipc: FakeIpc

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-notes-ipc-'))
  ipc = new FakeIpc()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeCtx(): AppContext {
  const ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  db = ctx.db
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-04T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-04T00:00:00Z')").run()
  db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', '测试', 'http://x', 'k', '2026-09-04T00:00:00Z')").run()
  return ctx
}

function seedKeyframe(lessonId = 'l1'): void {
  const file = join(dir, 'kf-1.jpg')
  writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))
  db.prepare('INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'kf-1',
    lessonId,
    120,
    file,
    'hash',
    '2026-09-04T00:00:00Z'
  )
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return ipc.invoke(channel, ...args)
}

describe('notes:attachments (2026-09-04)', () => {
  it('returns the identity manifest (no bytes) with refs and timestamps (review F4)', async () => {
    const ctx = makeCtx()
    seedKeyframe()
    const pptFile = join(dir, 'page-000.png')
    writeFileSync(pptFile, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]))
    db.prepare('INSERT INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'ppt-0',
      'l1',
      0,
      pptFile,
      '2026-09-04T00:00:00Z'
    )
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:attachments', 'l1')) as {
      ok: boolean
      value?: Array<{ ref: string; kind: string; at: number | null; dataUrl?: string }>
    }
    expect(res.ok).toBe(true)
    expect(res.value).toHaveLength(2)
    expect(res.value?.[0]).toMatchObject({ ref: 'ppt:0', kind: 'ppt', at: null })
    expect(res.value?.[1]).toMatchObject({ ref: 'kf:1690625-kf-1'.replace('1690625-', ''), kind: 'keyframe', at: 120 })
    // Manifest carries NO payload — data streams per ref.
    expect(res.value?.some((a) => 'dataUrl' in a)).toBe(false)
  })

  it('attachmentData streams one image per ref; missing files resolve null (review F4)', async () => {
    const ctx = makeCtx()
    seedKeyframe()
    const pptFile = join(dir, 'page-000.png')
    writeFileSync(pptFile, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]))
    db.prepare('INSERT INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'ppt-0',
      'l1',
      0,
      pptFile,
      '2026-09-04T00:00:00Z'
    )
    registerIpc(ctx, ipc as never)
    const ppt = (await invoke('notes:attachmentData', 'l1', 'ppt:0')) as { ok: boolean; value?: { dataUrl: string } | null }
    expect(ppt.ok).toBe(true)
    // The helper labels every image jpeg (the browser sniffs the real bytes).
    expect(ppt.value?.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)

    const kf = (await invoke('notes:attachmentData', 'l1', 'kf:kf-1')) as { ok: boolean; value?: { ref: string } | null }
    expect(kf.value?.ref).toBe('kf:kf-1')

    const gone = (await invoke('notes:attachmentData', 'l1', 'kf:kf-gone')) as { ok: boolean; value?: unknown }
    expect(gone.ok).toBe(true)
    expect(gone.value).toBeNull()

    const bogus = (await invoke('notes:attachmentData', 'l1', 'not-a-ref')) as { ok: boolean; value?: unknown }
    expect(bogus.ok).toBe(true)
    expect(bogus.value).toBeNull()
  })

  it('empty lesson returns empty manifest', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:attachments', 'l1')) as { ok: boolean; value?: unknown[] }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual([])
  })
})

describe('notes:exportAnki (roadmap 2.2, 2026-09-04)', () => {
  it('writes concept and quiz TSV decks; quiz deck sits beside the chosen path', async () => {
    const ctx = makeCtx()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run(
      JSON.stringify({
        overview: 'o',
        knowledgeTree: { title: 'r', children: [] },
        methodology: 'm',
        concepts: [{ term: '大O', definition: '渐进上界' }],
        quiz: [{ question: '什么是大O？', answer: '渐进上界', source: 'concept', term: '大O' }]
      })
    )
    const firstPath = join(dir, 'chosen.txt')
    const prev = process.env.SEU_ANKI_PATH
    process.env.SEU_ANKI_PATH = firstPath
    try {
      registerIpc(ctx, ipc as never)
      const res = (await invoke('notes:exportAnki', 'l1')) as { ok: boolean; value?: { canceled: boolean; paths: string[] } }
      expect(res.ok).toBe(true)
      expect(res.value?.canceled).toBe(false)
      expect(res.value?.paths).toHaveLength(2)
      const quizPath = res.value?.paths[1] ?? ''
      expect(quizPath).toContain('Anki-自测题')
      const { readFileSync } = await import('fs')
      expect(readFileSync(firstPath, 'utf8')).toBe('大O\t渐进上界\t课时\n')
      expect(readFileSync(quizPath, 'utf8')).toBe('什么是大O？\t渐进上界\t课时\n')
    } finally {
      if (prev == null) delete process.env.SEU_ANKI_PATH
      else process.env.SEU_ANKI_PATH = prev
    }
  })

  it('fails with a readable error when the note has no decks', async () => {
    const ctx = makeCtx()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run(VALID_NOTE)
    const prev = process.env.SEU_ANKI_PATH
    process.env.SEU_ANKI_PATH = join(dir, 'x.txt')
    try {
      registerIpc(ctx, ipc as never)
      const res = (await invoke('notes:exportAnki', 'l1')) as { ok: boolean; error?: string }
      expect(res.ok).toBe(false)
      expect(res.error).toContain('概念卡或自测题')
    } finally {
      if (prev == null) delete process.env.SEU_ANKI_PATH
      else process.env.SEU_ANKI_PATH = prev
    }
  })
})

describe('notes:regenerate (2026-09-04)', () => {
  it('reuses stored transcript/keyframes, inserts a new version row', async () => {
    const ctx = makeCtx()
    seedKeyframe()
    db.prepare(
      "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run(JSON.stringify([{ at: 0, text: '转写' }]))
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')").run()

    const chatJson = vi.fn(async () => VALID_NOTE)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as {
      ok: boolean
      value?: { version: number; images: number; hitRate: { hits: number; total: number } }
    }
    expect(res.ok).toBe(true)
    // Roadmap 1.3: the cited evidence ref resolves against the sent images.
    expect(res.value).toEqual({ version: 1, images: 1, hitRate: { hits: 1, total: 1 }, droppedRefs: 0 })
    const row = db.prepare('SELECT version, model FROM notes WHERE lesson_id = ?').get('l1') as { version: number; model: string }
    expect(row).toEqual({ version: 1, model: 'mimo-v2.5' })
  })

  it('fails with a readable error when the transcript is missing', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'm')").run()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('转写')
  })

  it('refuses while a task for the lesson is pending/running', async () => {
    const ctx = makeCtx()
    db.prepare(
      "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run(JSON.stringify([{ at: 0, text: '转写' }]))
    db.prepare(
      "INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t1', 'l1', 'summarizing', '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z')"
    ).run()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('运行中')
  })
})

describe('notes:exportMarkdown naming (批D, 2026-09-04)', () => {
  it('proposes a full course-teacher-lesson file name in the save dialog', async () => {
    const ctx = makeCtx()
    // makeCtx 已建 c1（课程/课时）——直接补充教师与课程名。
    db.prepare("UPDATE courses SET name = '算法导论', teacher = '汪海' WHERE id = 'c1'").run()
    registerIpc(ctx, ipc as never)
    const { dialog } = (await import('electron')) as { dialog: { showSaveDialog: (w: unknown, o?: unknown) => Promise<{ canceled: boolean }> } }
    let captured: { defaultPath?: string } | undefined
    // BrowserWindow.getFocusedWindow() 是 null → ipc 走单参数签名。
    dialog.showSaveDialog = vi.fn(async (a: unknown, b?: { defaultPath?: string }) => {
      captured = (b ?? (a as { defaultPath?: string })) as { defaultPath?: string }
      return { canceled: true }
    }) as never
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n-name', 'l1', 1, ?, 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run(VALID_NOTE)
    const res = (await ipc.invoke('notes:exportMarkdown', 'l1')) as { ok: boolean; value?: { canceled: boolean } }
    expect(res.ok).toBe(true)
    expect(captured?.defaultPath).toContain('算法导论 - 汪海 - 课时.md')
  })
})

describe('notes:list / qa:recent (批B, 2026-09-04)', () => {
  it('notes:list returns one row per lesson with course/teacher, newest first', async () => {
    const ctx = makeCtx()
    db.prepare(
      "INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '第2节课', '2026-09-04T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-09-04T01:00:00Z')"
    ).run(VALID_NOTE)
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n2', 'l2', 3, ?, 'p', 'm', '2026-09-04T02:00:00Z')"
    ).run(VALID_NOTE)
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n3', 'l2', 2, ?, 'p', 'm', '2026-09-04T00:30:00Z')"
    ).run(VALID_NOTE)
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:list')) as {
      ok: boolean
      value?: Array<{ lessonId: string; version: number; courseName: string | null; teacher: string | null; lessonTitle: string | null }>
    }
    expect(res.ok).toBe(true)
    expect(res.value).toHaveLength(2)
    expect(res.value?.[0]).toMatchObject({ lessonId: 'l2', version: 3, courseName: '课程', teacher: null, lessonTitle: '第2节课' })
    expect(res.value?.[1]).toMatchObject({ lessonId: 'l1', version: 1, courseName: '课程', lessonTitle: '课时' })
  })

  it('notes:list returns an empty list on an empty library', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:list')) as { ok: boolean; value?: unknown[] }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual([])
  })

  it('qa:recent returns exchanges with lesson/course identity, newest first', async () => {
    const ctx = makeCtx()
    db.prepare(
      "INSERT INTO qa (id, lesson_id, question, answer, created_at) VALUES ('q1', 'l1', '第一问', '答一', '2026-09-04T01:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO qa (id, lesson_id, question, answer, created_at) VALUES ('q2', 'l1', '第二问', '答二', '2026-09-04T02:00:00Z')"
    ).run()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('qa:recent')) as {
      ok: boolean
      value?: Array<{ lessonId: string; question: string; courseName: string | null; lessonTitle: string | null }>
    }
    expect(res.ok).toBe(true)
    expect(res.value).toHaveLength(2)
    expect(res.value?.[0]).toMatchObject({ lessonId: 'l1', question: '第二问', courseName: '课程', lessonTitle: '课时' })
    expect(res.value?.[1]).toMatchObject({ question: '第一问' })
  })
})
