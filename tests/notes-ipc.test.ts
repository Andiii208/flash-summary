import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
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

// 批3 (2026-09-17): 这份夹具以前叫「丰富」，其实是 knowledgeTree 零子节点、
// timeline/concepts/quiz 全空的空壳——它能评 good **完全依赖体检「数组为空即跳过」
// 的漏洞**（该漏洞在批3 已修）。现在它必须真的满足规约。
const RICH_NOTE = JSON.stringify({
  overview: `## 本讲主线\n${'很长的主线叙述，覆盖本讲完整的知识推进与演示结果。'.repeat(6)}`,
  knowledgeTree: {
    title: '机器学习工程实践',
    children: [
      { title: '数据处理', children: [{ title: '加载与划分', children: [{ title: '张量批处理', children: [] }] }] },
      { title: '模型构建', children: [{ title: '线性分类器', children: [{ title: '前向传播', children: [] }] }] },
      { title: '训练调优', children: [{ title: '超参数搜索', children: [{ title: '容量控制', children: [] }] }] }
    ]
  },
  timeline: [
    {
      at: 0,
      title: '超参数调整演示',
      detail:
        '把模型宽度从 32 改到 64 之后，测试集精度由 0.97 回落到 0.87，训练集精度却继续上升，说明在这个数据量下容量过大已经明显过拟合。',
      refs: [],
      evidence: []
    }
  ],
  concepts: [
    {
      term: '学习率',
      definition:
        '优化算法中的步长参数，控制每次参数更新的幅度；过大会导致损失震荡难以收敛，过小则收敛速度极慢，通常需要配合学习率调度器在训练过程中动态调整。'
    }
  ],
  methodology: 'm',
  examCues: ['手推交叉熵损失的梯度公式'],
  questionsAndGaps: ['讲者留下的作业：完成模块化重构'],
  quiz: [
    { question: '学习率过大有什么后果?', answer: '损失震荡难以收敛。', source: 'concept', term: '学习率' },
    { question: '容量过大在本数据集上的表现是什么?', answer: '训练精度上升而测试精度回落。', source: 'concept', term: '学习率' },
    { question: '讲者建议的宽度取值是多少?', answer: '先压回 32。', source: 'concept', term: '学习率' },
    { question: '过拟合在本讲的判据是什么?', answer: '训练与测试精度走势背离。', source: 'concept', term: '学习率' },
    { question: '讲者给出的容量控制手段是什么?', answer: '减小模型宽度。', source: 'concept', term: '学习率' }
  ]
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
      value?: {
        version: number
        images: number
        hitRate: { hits: number; total: number }
        transcriptHitRate: { hits: number; total: number } | null
        refStats: Record<string, number>
        droppedRefs: number
      }
    }
    expect(res.ok).toBe(true)
    // Roadmap 1.3: the cited evidence ref resolves against the sent images.
    // 批1 (2026-09-17): 视觉锚（hitRate）与转写锚（transcriptHitRate）分列。
    // 本例转写 '转写' 只有 2 字、被近空段规则剔光，笔记也没有摘引 → 无从判断，
    // 所以转写锚为 null、refStats 全 0，且**不应**误删任何东西。
    // 批3: health 是本批新增字段。这份夹具并不合规（概览 4 字、无概念、知识树只有
    // 一层），所以返修环被触发了一次；但 mock 每次都返回同一份笔记 → warn 数没下降
    // → 返修被拒绝（这正是「只采纳真正改善的返修」的守卫）。所以 repaired=false，
    // 体检结论照实报 weak。
    expect(res.value).toEqual({
      version: 1,
      images: 1,
      hitRate: { hits: 1, total: 1 },
      transcriptHitRate: null,
      refStats: { total: 0, droppedAt: 0, clearedText: 0, quoted: 0, quotedVerified: 0, offNeighborhood: 0 },
      droppedRefs: 0,
      // 批3: 归一层丢弃计数。这份夹具的 timeline evidence 是合法的 kf:kf-1，
      // 也没有 quiz/conceptLinks/terms，所以一项没丢。
      normalizationDropped: {},
      health: { warnCount: 5, grade: 'weak', repaired: false, warnCountBeforeRepair: null }
    })
    const row = db.prepare('SELECT version, model FROM notes WHERE lesson_id = ?').get('l1') as { version: number; model: string }
    expect(row).toEqual({ version: 1, model: 'mimo-v2.5' })
  })

  it('批1: 转写带时间锚喂给模型，编造的摘引被清空、越界时间被丢弃', async () => {
    const ctx = makeCtx()
    seedKeyframe()
    db.prepare(
      "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run(
      JSON.stringify([
        { at: 0, text: '我们这节课讲梯度下降的收敛条件。' },
        { at: 120, text: '学习率过大时损失会震荡甚至发散。' }
      ])
    )
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')").run()

    // 真摘引（可核验）+ 编造摘引 + 越界时间，三态齐备。
    const noteJson = JSON.stringify({
      ...JSON.parse(VALID_NOTE),
      timeline: [
        {
          at: 120,
          title: '学习率过大',
          detail: '学习率过大时损失震荡，演示里从 0.1 调到 1.0 后直接发散。',
          refs: [
            { at: 120, text: '学习率过大时损失会震荡甚至发散' },
            { at: 99999, text: '这段转写里根本不存在的内容啊啊啊' }
          ],
          evidence: []
        }
      ]
    })
    const chatJson = vi.fn(async () => noteJson)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as {
      ok: boolean
      value?: {
        transcriptHitRate: { hits: number; total: number } | null
        refStats: Record<string, number>
      }
    }
    expect(res.ok).toBe(true)
    // 越界的那条整条丢弃；留下的真摘引命中 → 1/1。
    expect(res.value?.transcriptHitRate).toEqual({ hits: 1, total: 1 })
    expect(res.value?.refStats.droppedAt).toBe(1)

    // 且模型收到的是**带时间锚**的转写（本批的核心修复）。
    const firstCall = chatJson.mock.calls[0] as unknown as [Array<{ role: string; content: unknown }>]
    const userText = JSON.stringify(firstCall[0].at(-1)?.content)
    expect(userText).toContain('[00:00]')
    expect(userText).toContain('[02:00]')
  })

  it('批1: 摘引匹配不上转写时清空 text、保留 at（降级而非报错）', async () => {
    const ctx = makeCtx()
    seedKeyframe()
    db.prepare(
      "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run(JSON.stringify([{ at: 0, text: '这是真实存在的转写内容，讲的是矩阵乘法。' }]))
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')").run()

    const noteJson = JSON.stringify({
      ...JSON.parse(VALID_NOTE),
      timeline: [
        {
          at: 10,
          title: '矩阵乘法',
          detail: '矩阵乘法的维度必须满足左列等于右行，否则无法相乘。',
          refs: [{ at: 10, text: '讲者说了一句转写里完全没有的漂亮话啊啊' }],
          evidence: []
        }
      ]
    })
    const chatJson = vi.fn(async () => noteJson)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as { ok: boolean; value?: { refStats: Record<string, number> } }
    expect(res.ok).toBe(true)
    expect(res.value?.refStats.clearedText).toBe(1)
    expect(res.value?.refStats.droppedAt).toBe(0)

    const stored = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1').get('l1') as {
      note_json: string
    }
    const persisted = JSON.parse(stored.note_json) as { timeline: Array<{ refs: Array<{ at: number; text: string }> }> }
    // 定位（at）保住，摘引清空——退化为「定位到该分钟」，不是删掉整条。
    expect(persisted.timeline[0]?.refs[0]).toEqual({ at: 10, text: '' })
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

describe('批3 生成质量闭环：有界返修（2026-09-17）', () => {
  /** 体检完全达标的稿（复用 RICH_NOTE 的口径，作用域内自持一份）。 */
  const RICH = RICH_NOTE

  function seedRegenerate(): void {
    seedKeyframe()
    db.prepare(
      "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-04T00:00:00Z')"
    ).run(JSON.stringify([{ at: 0, text: '本讲完整讲了梯度下降的收敛条件与学习率取值影响。' }]))
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')").run()
  }

  const THIN = JSON.stringify({
    overview: '太短。',
    knowledgeTree: { title: 'root', children: [] },
    methodology: '方法',
    examCues: [],
    questionsAndGaps: []
  })

  it('首稿不达标 → 返修一次；返修稿达标则采纳（repaired=true, warn 归零）', async () => {
    const ctx = makeCtx()
    seedRegenerate()
    const chatJson = vi.fn(async () => THIN).mockResolvedValueOnce(THIN).mockResolvedValueOnce(RICH)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as {
      ok: boolean
      value?: { health: { warnCount: number; grade: string; repaired: boolean }; images: number }
    }
    expect(res.ok).toBe(true)
    // 返修前 5 项（太短/空概念/空时间线/树分支不足/树层数不足）→ 返修后 0 项。
    expect(res.value?.health).toEqual({ warnCount: 0, grade: 'good', repaired: true, warnCountBeforeRepair: 5 })
    // 恰好两次：生成 + 返修（返修不再触发第三次）。
    expect(chatJson).toHaveBeenCalledTimes(2)

    // 落库的是**返修后**的稿（概览已被写足）。
    const row = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1').get('l1') as {
      note_json: string
    }
    expect(row.note_json).toContain('本讲主线')
  })

  it('返修不发图 —— 第二次调用的 user 内容是纯文本，没有 image part', async () => {
    const ctx = makeCtx()
    seedRegenerate()
    const chatJson = vi.fn(async () => THIN).mockResolvedValueOnce(THIN).mockResolvedValueOnce(RICH)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    await invoke('notes:regenerate', 'l1')

    const generationMessages = (chatJson.mock.calls[0] as unknown as [Array<{ role: string; content: unknown }>])[0]
    const generationUser = generationMessages.find((m) => m.role === 'user')?.content as Array<{ type: string }>
    expect(generationUser.some((part) => part.type === 'image_url')).toBe(true)

    // 返修那一次是单条 string user 消息（buildRepairUserParts），因此天然无图 ——
    // 省掉第二次多模态费用。
    const repairMessages = (chatJson.mock.calls[1] as unknown as [Array<{ role: string; content: unknown }>])[0]
    expect(typeof repairMessages.find((m) => m.role === 'user')?.content).toBe('string')
    expect(repairMessages.some((m) => Array.isArray(m.content))).toBe(false)
  })

  it('返修没能改善时保留原稿（不为了好看而牺牲诚实）', async () => {
    const ctx = makeCtx()
    seedRegenerate()
    // 两次都返回同一份薄笔记 → warn 数不下降 → 拒绝返修。
    const chatJson = vi.fn(async () => THIN)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as { ok: boolean; value?: { health: { warnCount: number; repaired: boolean } } }
    expect(res.ok).toBe(true)
    expect(res.value?.health.repaired).toBe(false)
    expect(res.value?.health.warnCount).toBeGreaterThan(0)

    const row = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1').get('l1') as {
      note_json: string
    }
    expect(row.note_json).toContain('太短。')
  })

  it('首稿已达标则完全不做返修（省一次模型调用）', async () => {
    const ctx = makeCtx()
    seedRegenerate()
    const chatJson = vi.fn(async () => RICH)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as { ok: boolean; value?: { health: { warnCount: number; repaired: boolean } } }
    expect(res.ok).toBe(true)
    expect(res.value?.health).toEqual({ warnCount: 0, grade: 'good', repaired: false, warnCountBeforeRepair: null })
    expect(chatJson).toHaveBeenCalledTimes(1)
  })

  it('返修稿同样过证据过滤与摘引核验（返修不是编造的后门）', async () => {
    const ctx = makeCtx()
    seedRegenerate()
    const forged = JSON.stringify({
      ...JSON.parse(RICH),
      timeline: [
        {
          at: 0,
          title: '伪造引用',
          detail: '这一段里引用了一个不存在的证据和一个转写里没有的摘引，用来验证返修稿也要过同一套核验。',
          refs: [{ at: 0, text: '这句话在转写里根本找不到啊啊啊' }],
          evidence: [{ kind: 'keyframe', ref: 'kf:不存在的关键帧' }]
        }
      ]
    })
    const chatJson = vi.fn(async () => THIN).mockResolvedValueOnce(THIN).mockResolvedValueOnce(forged)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as { ok: boolean; value?: { droppedRefs: number } }
    expect(res.ok).toBe(true)
    // 伪造的视觉证据在落库前就被丢掉（两条路径共用 dropUnknownEvidence）。
    const row = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1').get('l1') as {
      note_json: string
    }
    expect(row.note_json).not.toContain('不存在的关键帧')
  })
})

describe('批3 归一化丢弃计数可见化（2026-09-17 item 3）', () => {
  it('模型编的 quiz / 关联 / terms 被归一层丢掉的条数如实回报（不再静默）', async () => {
    const ctx = makeCtx()
    seedKeyframe()
    db.prepare(
      "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-17T00:00:00Z')"
    ).run(JSON.stringify([{ at: 0, text: '本讲完整讲了梯度下降的收敛条件与学习率取值影响。' }]))
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')").run()
    // 三处故意非法：quiz 缺 answer、conceptLinks 指向不存在的概念、terms 引用未定义概念。
    const dirty = JSON.stringify({
      ...JSON.parse(RICH_NOTE),
      quiz: [
        { question: '合法题?', answer: '合法答案。', source: 'concept', term: '学习率' },
        { question: '缺答案的题?', source: 'concept', term: '学习率' },
        { question: '', answer: '空问题。', source: 'concept', term: '学习率' }
      ],
      conceptLinks: [
        { from: '学习率', to: '数据处理', label: '前提' },
        { from: '学习率', to: '不存在的概念', label: '对比' }
      ]
    })
    const chatJson = vi.fn(async () => dirty)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)

    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as {
      ok: boolean
      value?: { normalizationDropped: Record<string, number> }
    }
    expect(res.ok).toBe(true)
    // 2 条非法 quiz 与 1 条无法解析的关联都被拦下，且**数目可见**。
    expect(res.value?.normalizationDropped.quiz).toBe(2)
    expect(res.value?.normalizationDropped.conceptLinks).toBe(1)
  })

  it('全部合法时报空对象（不制造假警报）', async () => {
    const ctx = makeCtx()
    seedKeyframe()
    db.prepare(
      "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-17T00:00:00Z')"
    ).run(JSON.stringify([{ at: 0, text: '本讲完整讲了梯度下降的收敛条件与学习率取值影响。' }]))
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')").run()
    const chatJson = vi.fn(async () => RICH_NOTE)
    const chatFor = vi.spyOn(ctx, 'chatFor')
    chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:regenerate', 'l1')) as { ok: boolean; value?: { normalizationDropped: Record<string, number> } }
    expect(res.ok).toBe(true)
    expect(res.value?.normalizationDropped).toEqual({})
  })
})

describe('notes:exportPng (批5, plan 2026-09-17 item 3)', () => {
  /** 一段真 PNG 字节（魔数对、后面随意）——handler 只校验魔数。 */
  const PNG_BASE64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]).toString('base64')

  it('把渲染层光栅化好的 PNG 写到 SEU_PNG_PATH', async () => {
    const ctx = makeCtx()
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-09-17T00:00:00Z')"
    ).run(VALID_NOTE)
    registerIpc(ctx, ipc as never)
    const target = join(dir, 'map.png')
    const prev = process.env.SEU_PNG_PATH
    process.env.SEU_PNG_PATH = target
    try {
      const res = (await invoke('notes:exportPng', 'l1', PNG_BASE64)) as { ok: boolean; value?: { canceled: boolean; path?: string } }
      expect(res.ok).toBe(true)
      expect(res.value).toEqual({ canceled: false, path: target })
      const bytes = readFileSync(target)
      // 字节原样落盘（没有被二次编码/损坏）
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    } finally {
      if (prev == null) delete process.env.SEU_PNG_PATH
      else process.env.SEU_PNG_PATH = prev
    }
  })

  it('拒绝非 PNG 字节 —— 渲染层可信，但「把传来的字节直接写盘」这种面不该无条件打开', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const target = join(dir, 'bad.png')
    const prev = process.env.SEU_PNG_PATH
    process.env.SEU_PNG_PATH = target
    try {
      const notPng = Buffer.from('这不是 PNG').toString('base64')
      const res = (await invoke('notes:exportPng', 'l1', notPng)) as { ok: boolean; error?: string }
      expect(res.ok).toBe(false)
      expect(res.error).toContain('不是 PNG')
      expect(existsSync(target)).toBe(false)
    } finally {
      if (prev == null) delete process.env.SEU_PNG_PATH
      else process.env.SEU_PNG_PATH = prev
    }
  })

  it('空字节流也拒绝（截断的 base64 不该产出 0 字节文件）', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:exportPng', 'l1', '')) as { ok: boolean }
    expect(res.ok).toBe(false)
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
    // 批C: { items, total, limit }——total 是「一个课时一行」的总数（不受 limit 影响）。
    const res = (await ipc.invoke('notes:list')) as {
      ok: boolean
      value?: { items: Array<{ lessonId: string; version: number; courseName: string | null; teacher: string | null; lessonTitle: string | null }>; total: number; limit: number }
    }
    expect(res.ok).toBe(true)
    expect(res.value?.items).toHaveLength(2)
    expect(res.value?.total).toBe(2)
    expect(res.value?.limit).toBe(200)
    expect(res.value?.items[0]).toMatchObject({ lessonId: 'l2', version: 3, courseName: '课程', teacher: null, lessonTitle: '第2节课' })
    expect(res.value?.items[1]).toMatchObject({ lessonId: 'l1', version: 1, courseName: '课程', lessonTitle: '课时' })
  })

  it('批C: notes:list 的关键词在主进程过滤，且只匹配列表可见字段', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '第2节课', '2026-09-04T00:00:00Z')").run()
    db.prepare("UPDATE courses SET teacher = '汪海', classroom = '中山-312' WHERE id = 'c1'").run()
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('cn1', 'l1', 1, ?, 'p', 'm', '2026-09-04T01:00:00Z')").run(VALID_NOTE)
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('cn2', 'l2', 1, ?, 'p', 'm', '2026-09-04T02:00:00Z')").run(VALID_NOTE)
    registerIpc(ctx, ipc as never)

    // 命中课时名 → 只回那一行，且 total 是**过滤后**的总数。
    const byLesson = (await ipc.invoke('notes:list', { keyword: '第2节' })) as {
      value?: { items: Array<{ lessonId: string }>; total: number }
    }
    expect(byLesson.value?.items.map((i) => i.lessonId)).toEqual(['l2'])
    expect(byLesson.value?.total).toBe(1)

    // 命中教师名（列表里可见）→ 该教师的两条都回。
    const byTeacher = (await ipc.invoke('notes:list', { keyword: '汪海' })) as { value?: { items: unknown[]; total: number } }
    expect(byTeacher.value?.total).toBe(2)

    // 教室（列表里**看不见**的字段）不参与匹配——搜到一条不显示该词的行会被当成 bug。
    const byRoom = (await ipc.invoke('notes:list', { keyword: '中山' })) as { value?: { items: unknown[]; total: number } }
    expect(byRoom.value?.total).toBe(0)

    // 空关键词等于不过滤（不改变既有行为）。
    const noFilter = (await ipc.invoke('notes:list', { keyword: '   ' })) as { value?: { total: number } }
    expect(noFilter.value?.total).toBe(2)
  })

  it('批C: notes:list 支持 limit/offset 分页，total 不受影响', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '第2节课', '2026-09-04T00:00:00Z')").run()
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('pn1', 'l1', 1, ?, 'p', 'm', '2026-09-04T01:00:00Z')").run(VALID_NOTE)
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('pn2', 'l2', 1, ?, 'p', 'm', '2026-09-04T02:00:00Z')").run(VALID_NOTE)
    registerIpc(ctx, ipc as never)

    const first = (await ipc.invoke('notes:list', { limit: 1 })) as { value?: { items: Array<{ lessonId: string }>; total: number; limit: number } }
    expect(first.value?.items).toHaveLength(1)
    expect(first.value?.total).toBe(2)
    expect(first.value?.limit).toBe(1)

    const second = (await ipc.invoke('notes:list', { limit: 1, offset: 1 })) as { value?: { items: Array<{ lessonId: string }>; total: number } }
    expect(second.value?.items).toHaveLength(1)
    expect(second.value?.items[0]?.lessonId).not.toBe(first.value?.items[0]?.lessonId)
    expect(second.value?.total).toBe(2)

    // 硬帽子：渲染层传一个离谱的上限也不会一次拉爆。
    const capped = (await ipc.invoke('notes:list', { limit: 99999 })) as { value?: { limit: number } }
    expect(capped.value?.limit).toBe(500)
  })

  it('notes:list returns an empty list on an empty library', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:list')) as { ok: boolean; value?: { items: unknown[]; total: number } }
    expect(res.ok).toBe(true)
    expect(res.value?.items).toEqual([])
    expect(res.value?.total).toBe(0)
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
    // l2 的薄笔记在批3 之后是 5 个 warn（此前只有 1 个——体检太浅）。逐条对应：
    // 概览过短 / 概念为空 / 时间线为空 / 知识树主分支不足 / 知识树层数不足。
    expect(rows.find((r) => r.lessonId === 'l2')).toMatchObject({ version: 1, warnCount: 5, grade: 'weak' })
    expect(rows.find((r) => r.lessonId === 'l3')).toMatchObject({ warnCount: 3, grade: 'weak' })
    // 默认勾选口径（批3 扩为两条）：warn>0 **或** 工艺版本落后。
    // 这里的 seedNote 不带 prompt_version → 落库默认 0 = 旧版本，所以三门课都入选；
    // 为了把「warn 这条规则」单独验出来，本条只用当前版本戳 l1 之外的两门。
    const { defaultSelection } = await import('../src/renderer/components/NoteUpgradeDialog')
    const { CURRENT_PROMPT_VERSION } = await import('../src/shared/notes/schema')
    const nowCurrent = rows.map((r) => ({ ...r, promptVersion: CURRENT_PROMPT_VERSION }))
    expect(defaultSelection(nowCurrent, CURRENT_PROMPT_VERSION)).toEqual(['l2', 'l3'])
    // 存量笔记（0）即使体检达标也会被建议升级——这正是批3 补的那条规则。
    // 顺序沿用入参顺序（rows 按课时标题排），所以是 l2/l3/l1。
    expect(defaultSelection(rows as NonNullable<typeof res.value>, CURRENT_PROMPT_VERSION)).toEqual(['l2', 'l3', 'l1'])
  })

  it('notes:list rows carry courseId (升级入口的分组定位键)', async () => {
    const ctx = makeCtx()
    seedNote('l1', 1, THIN_NOTE)
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:list')) as { ok: boolean; value?: { items: Array<{ lessonId: string; courseId: string | null }> } }
    expect(res.ok).toBe(true)
    expect(res.value?.items[0]).toMatchObject({ lessonId: 'l1', courseId: 'c1' })
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

describe('notes:exportCourseObsidian (Obsidian 批2, plan 2026-09-08-obsidian-export)', () => {
  const NOTE_A = JSON.stringify({
    overview: 'o',
    knowledgeTree: { title: 'r', children: [] },
    methodology: 'm',
    concepts: [
      { term: '傅里叶级数', definition: '第一讲的定义。' },
      { term: '频谱', definition: '频率域分布。' }
    ],
    examCues: [],
    questionsAndGaps: []
  })
  const NOTE_B = JSON.stringify({
    overview: 'o',
    knowledgeTree: { title: 'r', children: [] },
    methodology: 'm',
    concepts: [{ term: '傅里叶级数', definition: '第二讲的再表述。' }],
    examCues: [],
    questionsAndGaps: []
  })
  function seedCourseLessons(): void {
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '第2节课', '2026-09-08T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l3', 'c1', '第3节课 无笔记', '2026-09-08T00:00:00Z')").run()
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-09-08T00:00:00Z')").run(NOTE_A)
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n2', 'l2', 1, ?, 'p', 'm', '2026-09-08T00:00:00Z')").run(NOTE_B)
  }

  it('exports every noted lesson + _概念.md aggregation + vault-wide _index.md', async () => {
    const ctx = makeCtx()
    seedCourseLessons()
    const vault = join(dir, 'vault')
    const prev = process.env.SEU_OBSIDIAN_PATH
    process.env.SEU_OBSIDIAN_PATH = vault
    try {
      registerIpc(ctx, ipc as never)
      const res = (await invoke('notes:exportCourseObsidian', 'c1')) as {
        ok: boolean
        value?: { canceled: boolean; exported?: number; skipped?: number }
      }
      expect(res.ok).toBe(true)
      expect(res.value).toEqual({ canceled: false, exported: 2, skipped: 1 })
      const { readFileSync, existsSync } = await import('fs')
      const courseDir = join(vault, 'Flash Summary', '课程')
      expect(existsSync(join(courseDir, '第2节课.md'))).toBe(true)
      // 聚合页：同名概念跨课时归并，带课时 wikilink。
      const concepts = readFileSync(join(courseDir, '_概念.md'), 'utf8')
      expect(concepts).toContain('## [[傅里叶级数]]')
      expect(concepts).toContain('- [[第2节课]]：第二讲的再表述。')
      expect(concepts).toContain('## [[频谱]]')
      // 全库索引：结构约定 + 课程清单（计数只含已导出课时）。
      const index = readFileSync(join(vault, 'Flash Summary', '_index.md'), 'utf8')
      expect(index).toContain('kind: index')
      expect(index).toContain('- [[课程]]（2 课时）')
    } finally {
      if (prev == null) delete process.env.SEU_OBSIDIAN_PATH
      else process.env.SEU_OBSIDIAN_PATH = prev
    }
  })

  it('fails with a readable error for a missing course', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await invoke('notes:exportCourseObsidian', 'nope')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('课程不存在')
  })
})
