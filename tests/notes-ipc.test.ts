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

describe('notes:exportSvg (M3.3, 2026-09-05)', () => {
  it('writes a paper-white SVG of the knowledge tree via the SEU_SVG_PATH seam', async () => {
    const ctx = makeCtx()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-09-05T00:00:00Z')"
    ).run(VALID_NOTE)
    const target = join(dir, 'map.svg')
    const prev = process.env.SEU_SVG_PATH
    process.env.SEU_SVG_PATH = target
    try {
      registerIpc(ctx, ipc as never)
      const res = (await invoke('notes:exportSvg', 'l1')) as { ok: boolean; value?: { canceled: boolean; path?: string } }
      expect(res.ok).toBe(true)
      expect(res.value?.canceled).toBe(false)
      expect(res.value?.path).toBe(target)
      const { readFileSync } = await import('fs')
      const svg = readFileSync(target, 'utf8')
      expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
      expect(svg).toContain('root')
      expect(svg).toContain('child')
    } finally {
      if (prev == null) delete process.env.SEU_SVG_PATH
      else process.env.SEU_SVG_PATH = prev
    }
  })

  it('fails with a readable error when the lesson has no note', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:exportSvg', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('该课时尚无笔记')
  })
})

describe('notes:courseTree (M4.1, 2026-09-05)', () => {
  it('aggregates every lesson\'s latest tree in «第N节» order, skipping corrupt notes', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '第2节课 进阶', '2026-09-05T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l3', 'c1', '第1节课 基础', '2026-09-05T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l4', 'c1', '第4节课 坏档', '2026-09-05T00:00:00Z')").run()
    const note = (tree: object) =>
      JSON.stringify({ overview: 'o', knowledgeTree: tree, methodology: 'm', examCues: [], questionsAndGaps: [] })
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-09-05T00:00:00Z')"
    ).run(note({ title: '旧版', children: [] }))
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n2', 'l1', 2, ?, 'p', 'm', '2026-09-05T00:00:00Z')"
    ).run(note({ title: '课时主题', children: [{ title: '分支A', children: [] }] }))
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n3', 'l2', 1, ?, 'p', 'm', '2026-09-05T00:00:00Z')"
    ).run(note({ title: '进阶', children: [{ title: '分支B', children: [] }] }))
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n4', 'l3', 1, ?, 'p', 'm', '2026-09-05T00:00:00Z')"
    ).run(note({ title: '基础', children: [] }))
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n5', 'l4', 1, ?, 'p', 'm', '2026-09-05T00:00:00Z')"
    ).run('{broken json')
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:courseTree', 'c1')) as { ok: boolean; value?: { tree: { title: string; children: Array<{ title: string; children: unknown[] }> }; lessons: number; skipped: number } }
    expect(res.ok).toBe(true)
    expect(res.value?.lessons).toBe(3)
    expect(res.value?.skipped).toBe(1)
    // «第N节» ascending; the unnumbered lesson tails. Only the LATEST
    // version per lesson feeds the map.
    expect(res.value?.tree.title).toBe('课程')
    expect(res.value?.tree.children.map((lesson) => lesson.title)).toEqual(['第1节课 基础', '第2节课 进阶', '课时'])
    expect(res.value?.tree.children[2]!.children).toHaveLength(1)
  })

  it('fails with a readable error for a missing course', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:courseTree', 'nope')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('课程不存在')
  })
})

describe('notes:polish (批5, plan 2026-09-07 v07)', () => {  function seedTranscribedLesson(): AppContext {
    const ctx = makeCtx()
    db.prepare(
      "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-08T00:00:00Z')"
    ).run(JSON.stringify([{ at: 0, text: '转写' }]))
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')").run()
    return ctx
  }

  it('rejects an empty feedback payload before touching the queue', async () => {
    const ctx = seedTranscribedLesson()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:polish', 'l1', { tags: [], text: '   ' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('至少一个问题')
  })

  it('refuses while a task for the lesson is queued/running (regenerate 的同款守卫)', async () => {
    const ctx = seedTranscribedLesson()
    db.prepare(
      "INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t1', 'l1', 'summarizing', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00Z')"
    ).run()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:polish', 'l1', { tags: ['too_brief'], text: '' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('运行中')
  })

  it('errors with a readable message when the lesson has no note to polish', async () => {
    const ctx = seedTranscribedLesson()
    const chatJson = vi.fn(async () => VALID_NOTE)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:polish', 'l1', { tags: ['too_brief'], text: '篇幅再长一点' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('还没有笔记')
    expect(chatJson).not.toHaveBeenCalled()
  })

  it('polishes into the next version and returns version + hitRate', async () => {
    const ctx = seedTranscribedLesson()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('l1-v1', 'l1', 1, ?, 'p', 'm', '2026-09-08T00:00:00Z')"
    ).run(VALID_NOTE)
    const chatJson = vi.fn(async () => VALID_NOTE)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:polish', 'l1', { tags: ['too_brief'], text: '' })) as {
      ok: boolean
      value?: { version: number; hitRate: { hits: number; total: number }; droppedRefs: number }
    }
    expect(res.ok).toBe(true)
    expect(res.value?.version).toBe(2)
    const row = db.prepare('SELECT model FROM notes WHERE lesson_id = ? AND version = 2').get('l1') as { model: string }
    expect(row.model).toContain('润色')
  })
})

describe('notes:courseHealth (质量批4, plan 2026-09-08 note-quality-overhaul)', () => {
  const RICH_NOTE = JSON.stringify({
    overview: `## 本讲主线\n${'很长的主线叙述，覆盖本讲完整的知识推进与演示结果。'.repeat(6)}`,
    knowledgeTree: { title: 'r', children: [] },
    timeline: [],
    concepts: [],
    methodology: 'm',
    examCues: ['手推交叉熵损失的梯度公式'],
    questionsAndGaps: ['讲者留下的作业：完成模块化重构'],
    quiz: []
  })
  const THIN_NOTE = JSON.stringify({
    overview: '太短。',
    knowledgeTree: { title: 'r', children: [] },
    methodology: 'm',
    examCues: [],
    questionsAndGaps: []
  })
  function seedNote(lessonId: string, version: number, noteJson: string): void {
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES (?, ?, ?, ?, 'p', 'm', '2026-09-08T00:00:00Z')"
    ).run(`${lessonId}-v${version}`, lessonId, version, noteJson)
  }

  it('reports per-lesson health of the LATEST version only, default-selected warns', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '第2节课', '2026-09-08T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l3', 'c1', '第3节课 坏档', '2026-09-08T00:00:00Z')").run()
    // l1: 薄 v1 + 丰富 v2 → 体检只看 v2（good）。
    seedNote('l1', 1, THIN_NOTE)
    seedNote('l1', 2, RICH_NOTE)
    // l2: 只有薄 v1 → fair（warn 1）。
    seedNote('l2', 1, THIN_NOTE)
    // l3: 坏档 → 降级为 weak（warnCount 3）而不是让整门课失败。
    seedNote('l3', 1, '{broken json')
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:courseHealth', 'c1')) as {
      ok: boolean
      value?: Array<{ lessonId: string; lessonTitle: string; version: number; warnCount: number; grade: 'good' | 'fair' | 'weak' }>
    }
    expect(res.ok).toBe(true)
    const rows = res.value ?? []
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.lessonId === 'l1')).toMatchObject({ version: 2, warnCount: 0, grade: 'good' })
    expect(rows.find((r) => r.lessonId === 'l2')).toMatchObject({ version: 1, warnCount: 1, grade: 'fair' })
    expect(rows.find((r) => r.lessonId === 'l3')).toMatchObject({ warnCount: 3, grade: 'weak' })
    // 默认勾选口径 = warn>0（D2=A）——排除已达标的 l1。
    const { defaultSelection } = await import('../src/renderer/components/NoteUpgradeDialog')
    expect(defaultSelection(rows as NonNullable<typeof res.value>)).toEqual(['l2', 'l3'])
  })

  it('notes:list rows carry courseId (升级入口的分组定位键)', async () => {
    const ctx = makeCtx()
    seedNote('l1', 1, THIN_NOTE)
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:list')) as { ok: boolean; value?: Array<{ lessonId: string; courseId: string | null }> }
    expect(res.ok).toBe(true)
    expect(res.value?.[0]).toMatchObject({ lessonId: 'l1', courseId: 'c1' })
  })

  it('fails with a readable error for a missing course', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:courseHealth', 'nope')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('课程不存在')
  })
})

describe('notes:exportObsidian (Obsidian 批1, plan 2026-09-08-obsidian-export)', () => {
  const NOTE = JSON.stringify({
    overview: 'o',
    knowledgeTree: { title: 'r', children: [] },
    timeline: [{ at: 120, title: 't', detail: 'd', refs: [], evidence: [{ kind: 'keyframe', ref: 'kf:kf-1' }] }],
    methodology: 'm',
    examCues: [],
    questionsAndGaps: []
  })
  function seedNote(version = 1, noteJson = NOTE): void {
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', ?, ?, 'p', 'm', '2026-09-08T00:00:00Z')"
    ).run(version, noteJson)
  }

  it('writes Flash Summary/<course>/<lesson>.md + cited attachments via the SEU_OBSIDIAN_PATH seam', async () => {
    const ctx = makeCtx()
    db.prepare("UPDATE courses SET name = '信号与系统' WHERE id = 'c1'").run()
    db.prepare("UPDATE lessons SET title = '第3节课' WHERE id = 'l1'").run()
    seedKeyframe()
    seedNote()
    const vault = join(dir, 'vault')
    const prev = process.env.SEU_OBSIDIAN_PATH
    process.env.SEU_OBSIDIAN_PATH = vault
    try {
      registerIpc(ctx, ipc as never)
      const res = (await invoke('notes:exportObsidian', 'l1')) as { ok: boolean; value?: { canceled: boolean; path?: string; version?: number } }
      expect(res.ok).toBe(true)
      expect(res.value?.canceled).toBe(false)
      expect(res.value?.path).toBe(join(vault, 'Flash Summary', '信号与系统', '第3节课.md'))
      const { readFileSync, existsSync } = await import('fs')
      const md = readFileSync(res.value?.path ?? '', 'utf8')
      expect(md).toContain('source: flash-summary')
      expect(md).toContain('course: 信号与系统')
      expect(md).toContain('![[l1-kf-1.jpg]]')
      // D4=A: 只带走被引用的附件（时间线绑定的那张关键帧）。
      expect(existsSync(join(vault, 'Flash Summary', '信号与系统', 'attachments', 'l1-kf-1.jpg'))).toBe(true)
      // Manifest 行落库（幂等对账键）。
      const manifestRow = db.prepare('SELECT vault_path, file_path, exported_version FROM obsidian_exports WHERE lesson_id = ?').get('l1') as {
        vault_path: string
        file_path: string
        exported_version: number
      }
      expect(manifestRow).toMatchObject({ vault_path: vault, exported_version: 1 })
    } finally {
      if (prev == null) delete process.env.SEU_OBSIDIAN_PATH
      else process.env.SEU_OBSIDIAN_PATH = prev
    }
  })

  it('re-export overwrites the same file; a renamed lesson cleans up the old one', async () => {
    const ctx = makeCtx()
    db.prepare("UPDATE lessons SET title = '第3节课' WHERE id = 'l1'").run()
    seedNote()
    const vault = join(dir, 'vault')
    const prev = process.env.SEU_OBSIDIAN_PATH
    process.env.SEU_OBSIDIAN_PATH = vault
    try {
      registerIpc(ctx, ipc as never)
      await invoke('notes:exportObsidian', 'l1')
      // 重新生成出一版 v2，再导出 → 覆盖同路径，manifest 推进到 v2。
      db.prepare("UPDATE notes SET note_json = ? WHERE lesson_id = 'l1' AND version = 1").run(NOTE)
      db.prepare(
        "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n2', 'l1', 2, ?, 'p', 'm', '2026-09-08T01:00:00Z')"
      ).run(NOTE)
      await invoke('notes:exportObsidian', 'l1')
      const { readFileSync, existsSync } = await import('fs')
      const file = join(vault, 'Flash Summary', '课程', '第3节课.md')
      expect(readFileSync(file, 'utf8')).toContain('version: 2')
      // 课时改名 → 写新路径、删旧文件、manifest 指向新路径。
      db.prepare("UPDATE lessons SET title = '第九节 复习课' WHERE id = 'l1'").run()
      await invoke('notes:exportObsidian', 'l1')
      expect(existsSync(join(vault, 'Flash Summary', '课程', '第3节课.md'))).toBe(false)
      expect(existsSync(join(vault, 'Flash Summary', '课程', '第九节 复习课.md'))).toBe(true)
      const manifestRow = db.prepare('SELECT file_path, exported_version FROM obsidian_exports WHERE lesson_id = ?').get('l1') as {
        file_path: string
        exported_version: number
      }
      expect(manifestRow.file_path).toContain('第九节 复习课.md')
      expect(manifestRow.exported_version).toBe(2)
    } finally {
      if (prev == null) delete process.env.SEU_OBSIDIAN_PATH
      else process.env.SEU_OBSIDIAN_PATH = prev
    }
  })

  it('fails with a readable error when the lesson has no note', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:exportObsidian', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('该课时尚无笔记')
  })
})
