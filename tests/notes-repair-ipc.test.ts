import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import { claimNoteInflight, releaseNoteInflight } from '../src/main/notes/inflight'
import type { Cryptor } from '../src/main/auth/session-crypto'

vi.mock('electron', () => ({
  ipcMain: undefined,
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
  BrowserWindow: { getFocusedWindow: () => null },
  WebContents: undefined
}))

setAppRendererOrigin('file:///app/index.html')

class FakeIpc {
  readonly handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, fn)
  }
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    return fn({ senderFrame: { url: 'file:///app/index.html' } }, ...args)
  }
}

const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

/** 体检完全达标的稿（口径同 notes-ipc.test.ts 的 RICH_NOTE：warnCount 0）。 */
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

/** 体检不达标的薄稿（概览过短 / 概念为空 / 时间线为空 / 树分支不足 / 树层数不足 = 5 warn）。 */
const THIN_NOTE = JSON.stringify({
  overview: '太短。',
  knowledgeTree: { title: 'root', children: [] },
  methodology: '方法',
  examCues: [],
  questionsAndGaps: []
})

/**
 * RICH 的形状（0 形状 warn）+ 一条**在转写里找不到**的摘引 → 唯一 warn 是转写命中率 0/1。
 *
 * 存盘补全这条路径上「只差命中率」的两条通道行为不同（批2 二次评审订正，见下面两个用例）：
 * - 转写通道（本夹具）：核验结果取决于模型是否真的重写了那句话 → 模型原样返回时 warn 不降
 *   → 不采纳（方案 §2.2 想说的就是这一支）；
 * - 证据通道（`RICH_ONE_DEAD_REF`）：`repairOnce` 无条件先过 `dropUnknownEvidence`（返修
 *   不是编造的后门），死引用不管模型答什么都留不下来 → 命中率必然回到 100%，warn 必然下降
 *   → 采纳。方案 §2.2 原写「返修后 warnCount 不变」对证据通道**不成立**，已按实测订正。
 */
const RICH_ONE_UNVERIFIABLE_QUOTE = JSON.stringify({
  ...JSON.parse(RICH_NOTE),
  timeline: [
    {
      at: 0,
      title: '超参数调整演示',
      detail:
        '把模型宽度从 32 改到 64 之后，测试集精度由 0.97 回落到 0.87，训练集精度却继续上升，说明在这个数据量下容量过大已经明显过拟合。',
      refs: [{ at: 0, text: '这句话在转写里根本找不到啊啊啊' }],
      evidence: []
    }
  ]
})

/** 同上，但把唯一 warn 换成证据命中率：引用的 kf-404 在库里不存在（0/1）。 */
const RICH_ONE_DEAD_REF = JSON.stringify({
  ...JSON.parse(RICH_NOTE),
  timeline: [
    {
      at: 0,
      title: '超参数调整演示',
      detail:
        '把模型宽度从 32 改到 64 之后，测试集精度由 0.97 回落到 0.87，训练集精度却继续上升，说明在这个数据量下容量过大已经明显过拟合。',
      refs: [],
      evidence: [{ kind: 'keyframe', ref: 'kf:kf-404' }]
    }
  ]
})

let db: Db
let dir: string
let ipc: FakeIpc

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-repair-ipc-'))
  ipc = new FakeIpc()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeCtx(): AppContext {
  const ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  db = ctx.db
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-20T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-20T00:00:00Z')").run()
  db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', '测试', 'http://x', 'k', '2026-09-20T00:00:00Z')").run()
  return ctx
}

function seedTranscript(): void {
  db.prepare(
    "INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-20T00:00:00Z')"
  ).run(
    JSON.stringify([
      { at: 0, text: '我们这节课讲梯度下降的收敛条件。' },
      { at: 120, text: '学习率过大时损失会震荡甚至发散。' }
    ])
  )
}

function seedBinding(model = 'gpt-4o'): void {
  db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', ?)").run(model)
}

function seedNote(noteJson: string, version = 1): void {
  db.prepare(
    "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES (?, 'l1', ?, ?, 'p', 'm', '2026-09-20T00:00:00Z')"
  ).run(`l1-v${version}`, version, noteJson)
}

/** 一张真关键帧（补全路径不读图，但 refs 集合要真实——`loadValidRefs` 从库里取）。 */
function seedKeyframe(): void {
  const file = join(dir, 'kf-1.jpg')
  writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))
  db.prepare('INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'kf-1',
    'l1',
    120,
    file,
    'hash',
    '2026-09-20T00:00:00Z'
  )
}

/** 把 ctx.chatFor 换成固定回答的桩（补全路径只调 chatJson）。 */
function stubChat(ctx: AppContext, answers: string[]): ReturnType<typeof vi.fn> {
  const chatJson = vi.fn()
  for (const answer of answers) chatJson.mockResolvedValueOnce(answer)
  const chatFor = vi.spyOn(ctx, 'chatFor')
  chatFor.mockImplementation(() => ({ chatJson, transcribe: async () => '' }) as never)
  return chatJson
}

function noteRowCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM notes WHERE lesson_id = ?').get('l1') as { n: number }).n
}

describe('notes:repair（批2, plan 2026-09-20-ux-issues-remediation P2）', () => {
  it('该课时还没有笔记 → 拒绝，且不调模型', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedBinding()
    const chatJson = stubChat(ctx, [RICH_NOTE])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('还没有笔记')
    expect(chatJson).not.toHaveBeenCalled()
  })

  it('转写缺失 → 拒绝（先查素材再查绑定，错误不互相伪装）', async () => {
    const ctx = makeCtx()
    seedBinding()
    seedNote(THIN_NOTE)
    const chatJson = stubChat(ctx, [RICH_NOTE])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('转写')
    expect(chatJson).not.toHaveBeenCalled()
  })

  it('未绑定多模态模型 → 给出可执行的下一步（不是 chatFor 的原始报错）', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedNote(THIN_NOTE)
    const chatJson = stubChat(ctx, [RICH_NOTE])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('未绑定多模态模型')
    expect(chatJson).not.toHaveBeenCalled()
  })

  it('体检 0 warn → 一次模型调用都不花（空转不烧钱），也不涨版本', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedKeyframe()
    seedBinding()
    seedNote(RICH_NOTE)
    const chatJson = stubChat(ctx, [RICH_NOTE])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('没有需要补全的问题')
    expect(chatJson).not.toHaveBeenCalled()
    expect(noteRowCount()).toBe(1)
  })

  it('采纳才存新版本：返修稿 warn 数下降 → 新版本落库、口径前后一致', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedKeyframe()
    seedBinding()
    seedNote(THIN_NOTE)
    const chatJson = stubChat(ctx, [RICH_NOTE])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as {
      ok: boolean
      value?: { version: number; repaired: boolean; health: { warnCount: number; grade: string; warnCountBeforeRepair: number | null }; transcriptHitRate: unknown }
    }
    expect(res.ok).toBe(true)
    expect(res.value?.repaired).toBe(true)
    expect(res.value?.version).toBe(2)
    // 前置体检 5 项（薄稿的形状 warn）→ 返修后 0 项；两头的口径都是
    // 「形状 + 证据命中率 + 转写命中率」这一组判据。
    expect(res.value?.health).toEqual({ warnCount: 0, grade: 'good', warnCountBeforeRepair: 5 })
    expect(chatJson).toHaveBeenCalledTimes(1)
    expect(noteRowCount()).toBe(2)
    const stored = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ? AND version = 2').get('l1') as { note_json: string }
    expect(stored.note_json).toContain('本讲主线')
  })

  it('不改善就保留原稿：版本号不变、原稿字节不变、toast 不会说「N 项 → M 项」', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedKeyframe()
    seedBinding()
    seedNote(THIN_NOTE)
    // 模型两次都回同一份薄稿 → warn 数不下降 → 拒绝采纳。
    stubChat(ctx, [THIN_NOTE])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as {
      ok: boolean
      value?: { version: number; repaired: boolean; health: { warnCount: number; warnCountBeforeRepair: number | null } }
    }
    expect(res.ok).toBe(true)
    expect(res.value?.repaired).toBe(false)
    expect(res.value?.version).toBe(1)
    // 渲染层的「已补全：体检 N 项 → M 项」条件是 repaired && warnCountBeforeRepair != null。
    expect(res.value?.health.warnCountBeforeRepair).toBeNull()
    expect(noteRowCount()).toBe(1)
    const stored = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ?').get('l1') as { note_json: string }
    expect(stored.note_json).toContain('太短。')
  })

  it('只有命中率 warn（转写摘引核验不上）时不被误判成「补全成功」', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedKeyframe()
    seedBinding()
    seedNote(RICH_ONE_UNVERIFIABLE_QUOTE)
    // 模型原样返回 → 那句摘引再次核验不上 → 转写命中率仍是 0/1 → warn 数不降。
    const chatJson = stubChat(ctx, [RICH_ONE_UNVERIFIABLE_QUOTE])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as {
      ok: boolean
      value?: { version: number; repaired: boolean; health: { warnCount: number; grade: string; warnCountBeforeRepair: number | null }; transcriptHitRate: unknown }
    }
    expect(res.ok).toBe(true)
    expect(chatJson).toHaveBeenCalledTimes(1)
    // 旧口径（复检只按笔记形状）会在这里给出 warnCount 0 + repaired=true 的虚假成功。
    expect(res.value?.repaired).toBe(false)
    expect(res.value?.version).toBe(1)
    expect(res.value?.health).toEqual({ warnCount: 1, grade: 'fair', warnCountBeforeRepair: null })
    expect(res.value?.transcriptHitRate).toEqual({ hits: 0, total: 1 })
    expect(noteRowCount()).toBe(1)
  })

  // 批2 二次评审点名：证据通道在存盘补全路径上此前没有用例，而它的行为与方案
  // §2.2 的原文「只差证据命中率 → 返修后 warnCount 不变 → 不采纳」相反——照实钉住。
  // 根因：`repairOnce` 对返修稿无条件先过 `dropUnknownEvidence`（返修不是编造的后门），
  // 死引用被丢掉后 `evidenceHitRate` 的分子分母同时缩小 → 命中率回到 100%（或 total=0
  // 不再出 warn）→ warn 数必然下降。这不是虚假成功：判定与 toast 用的是**同一把尺子**
  // （noteHealth + 同一份 refs），新版本里那几条死引用是真的没了。
  it('批2 订正: 只有证据命中率 warn（引用已失效的 ref）时，死引用被丢弃 → 命中率回到 100% 并采纳', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedKeyframe() // 库里只有 kf-1
    seedBinding()
    seedNote(RICH_ONE_DEAD_REF)
    // 模型原样返回：那句引用仍指向不存在的 kf-404，但返修稿过 dropUnknownEvidence 后
    // 它不再存在，命中率因此回到 total=0（不出 warn）。
    const chatJson = stubChat(ctx, [RICH_ONE_DEAD_REF])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as {
      ok: boolean
      value?: { version: number; repaired: boolean; health: { warnCount: number; grade: string; warnCountBeforeRepair: number | null } }
    }
    expect(res.ok).toBe(true)
    expect(chatJson).toHaveBeenCalledTimes(1)
    // 前置体检的唯一 warn 就是证据命中率 0/1。
    expect(res.value?.repaired).toBe(true)
    expect(res.value?.version).toBe(2)
    expect(res.value?.health).toEqual({ warnCount: 0, grade: 'good', warnCountBeforeRepair: 1 })
    // 采纳的是「死引用真的没了」的那一版——不是把 warn 藏起来。
    const stored = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ? AND version = 2').get('l1') as { note_json: string }
    expect(stored.note_json).not.toContain('kf-404')
    expect(noteRowCount()).toBe(2)
  })

  it('不发图：唯一那次模型调用的 user 消息是纯文本（补全只带转写）', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedKeyframe()
    seedBinding()
    seedNote(THIN_NOTE)
    const chatJson = stubChat(ctx, [RICH_NOTE])
    registerIpc(ctx, ipc as never)
    await ipc.invoke('notes:repair', 'l1')
    const messages = (chatJson.mock.calls[0] as unknown as [Array<{ role: string; content: unknown }>])[0]
    expect(messages.some((m) => Array.isArray(m.content))).toBe(false)
    expect(typeof messages.find((m) => m.role === 'user')?.content).toBe('string')
    // 转写确实进了提示词（返修的事实依据）。
    expect(String(messages.find((m) => m.role === 'user')?.content)).toContain('[02:00]')
  })

  it('该课时有在途笔记写操作 → 拒绝（与 regenerate/polish 共用登记，防版本号撞车）', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedBinding()
    seedNote(THIN_NOTE)
    const chatJson = stubChat(ctx, [RICH_NOTE])
    registerIpc(ctx, ipc as never)
    expect(claimNoteInflight('l1', 'regenerate')).toBe(true)
    try {
      const res = (await ipc.invoke('notes:repair', 'l1')) as { ok: boolean; error?: string }
      expect(res.ok).toBe(false)
      expect(res.error).toContain('在进行中')
      expect(chatJson).not.toHaveBeenCalled()
    } finally {
      releaseNoteInflight('l1')
    }
  })

  it('该课时存在排队/运行中的任务 → 拒绝', async () => {
    const ctx = makeCtx()
    seedTranscript()
    seedBinding()
    seedNote(THIN_NOTE)
    db.prepare(
      "INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t1', 'l1', 'summarizing', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')"
    ).run()
    const chatJson = stubChat(ctx, [RICH_NOTE])
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:repair', 'l1')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('运行中')
    expect(chatJson).not.toHaveBeenCalled()
  })
})
