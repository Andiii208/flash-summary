import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { openDatabase, type Db } from '../src/main/db/open'
import { makeTranscribe, makeSummarize, MAX_SUMMARIZE_IMAGES, type OrchestratorDeps } from '../src/main/tasks/orchestrator'
import type { StageContext } from '../src/main/tasks/queue'
import type { SchoolClient } from '../src/main/school/client'
import type { Grid8x8 } from '../src/shared/phash'
import { ffmpegPath } from '../src/main/media/binaries'
import { DEFAULT_CHUNK_SECONDS } from '../src/main/media/audio-split'
import { ProviderError } from '../src/main/providers/openai-client'

/**
 * 一份**体检完全达标**的笔记（批3 2026-09-17）。
 *
 * 这些用例验证的是「图片怎么发 / caption 怎么写 / 视觉被拒时怎么降级」，不是返修。
 * 夹具若不合规，批3 的返修环会多打一次模型（那是**正确**的产品行为），从而搅乱
 * 这些用例的调用次数与 captured 断言。所以夹具必须是合规笔记——返修路径本身
 * 另有专门的用例覆盖（见 notes-ipc 的批3 用例）。
 */
const validNote = {
  overview:
    '## 本讲主线\n' +
    '本讲完整走了一遍线性分类模型的工程实践流程，覆盖环境搭建、数据加载、模型构建、训练评估与超参数调优的每个环节，并在每一步给出可复现的演示结果。'.repeat(2) +
    '\n## 前置知识\n需要了解基础的张量操作、训练循环结构以及简单的数据预处理方法。',
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
  methodology: '方法',
  examCues: ['手推交叉熵损失的梯度公式'],
  questionsAndGaps: ['讲者留下的作业：完成模块化重构'],
  quiz: [
    { question: '学习率过大有什么后果?', answer: '损失震荡难以收敛。', source: 'concept', term: '学习率' },
    { question: '容量过大在本数据集上的表现是什么?', answer: '训练精度上升而测试精度回落。', source: 'concept', term: '学习率' },
    { question: '讲者建议的宽度取值是多少?', answer: '先压回 32。', source: 'concept', term: '学习率' },
    { question: '过拟合在本讲的判据是什么?', answer: '训练与测试精度走势背离。', source: 'concept', term: '学习率' },
    { question: '讲者给出的容量控制手段是什么?', answer: '减小模型宽度。', source: 'concept', term: '学习率' }
  ]
}

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-u4-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-01T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-01T00:00:00Z')").run()
  db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', '测试', 'http://x', 'k', '2026-09-01T00:00:00Z')").run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeWav(seconds: number, target: string): void {
  execFileSync(
    ffmpegPath(),
    ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-ac', '1', '-ar', '16000', target],
    { stdio: 'pipe' }
  )
}

function stageOutputRow(taskId: string, stage: string, output: unknown): void {
  db.prepare(
    "INSERT OR IGNORE INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES (?, 'l1', 'pending', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')"
  ).run(taskId)
  db.prepare('INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)').run(
    taskId,
    stage,
    JSON.stringify(output)
  )
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const school = {
    lessonDetail: async () => ({ id: 'l1', courseId: 'c1', title: 'x', teacherStreamUrl: 'u', screenStreamUrl: 'v' }),
    listPpt: async () => []
  } as unknown as SchoolClient
  return {
    db,
    libraryRoot: dir,
    cacheDir: () => join(dir, 'cache'),
    ffmpeg: ffmpegPath(),
    ffprobe: 'ffprobe',
    school,
    chat: (() => ({ chat: async () => JSON.stringify(validNote), transcribe: async () => '文本' })) as unknown as (
      capability: 'asr' | 'multimodal' | 'text'
    ) => never,
    gridDecoder: (() => Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 128))) as unknown as (path: string) => Grid8x8,
    ...overrides
  }
}

function makeCtx(taskId = 't1'): StageContext {
  db.prepare(
    "INSERT OR IGNORE INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES (?, 'l1', 'pending', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')"
  ).run(taskId)
  return { taskId, lessonId: 'l1', stage: 'transcribing' }
}

describe('makeTranscribe chunking (U4)', () => {
  it('transcribes each default chunk with segment offsets and per-chunk progress', async () => {
    const audioPath = join(dir, 'audio.wav')
    makeWav(2, audioPath)
    stageOutputRow('t1', 'extracting_audio', { audioPath, durationSeconds: 1500 })
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p1', 'whisper-1')").run()

    const transcribe = vi.fn(async () => '分片文本')
    const chunks: number[] = []
    const deps = makeDeps({
      chat: (() => ({ transcribe, chat: async () => 'x' })) as unknown as OrchestratorDeps['chat'],
      onChunkProgress: (_ctx, _index, total) => chunks.push(total)
    })
    const result = await makeTranscribe(deps)(makeCtx())
    expect(result.status).toBe('ok')
    const expectedCount = Math.ceil(1500 / DEFAULT_CHUNK_SECONDS)
    const expectedStarts = Array.from({ length: expectedCount }, (_, i) => i * DEFAULT_CHUNK_SECONDS)
    expect(transcribe).toHaveBeenCalledTimes(expectedCount)
    const row = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get('l1') as { segments_json: string }
    const segments = JSON.parse(row.segments_json) as Array<{ at: number; text: string }>
    expect(segments.map((s) => s.at)).toEqual(expectedStarts)
    expect(segments.every((s) => s.text === '分片文本')).toBe(true)
    expect(chunks).toEqual(Array.from({ length: expectedCount }, () => expectedCount))
    expect(existsSync(audioPath)).toBe(false)
  })

  it('uses the source audio directly for a single chunk', async () => {
    const audioPath = join(dir, 'audio.wav')
    makeWav(1, audioPath)
    stageOutputRow('t1', 'extracting_audio', { audioPath, durationSeconds: 30 })
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p1', 'whisper-1')").run()
    const transcribe = vi.fn(async () => '整段')
    const deps = makeDeps({ chat: (() => ({ transcribe, chat: async () => 'x' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeTranscribe(deps)(makeCtx())
    expect(result.status).toBe('ok')
    expect(transcribe).toHaveBeenCalledTimes(1)
  })

  it('skips silent chunks and fails with a clear message when the whole lesson is silent', async () => {
    const audioPath = join(dir, 'audio-skip.wav')
    makeWav(2, audioPath)
    // 300s → 3 chunks (120s window): speech, silence, speech.
    stageOutputRow('t1-skip', 'extracting_audio', { audioPath, durationSeconds: 300 })
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p1', 'whisper-1')").run()
    const answers = ['第一段语音', '', '第三段语音']
    const transcribe = vi.fn(async () => answers.shift() ?? '')
    const deps = makeDeps({ chat: (() => ({ transcribe, chat: async () => 'x' })) as unknown as OrchestratorDeps['chat'] })
    let result = await makeTranscribe(deps)(makeCtx('t1-skip'))
    expect(result.status).toBe('ok')
    const row = db.prepare("SELECT segments_json FROM transcripts WHERE lesson_id = 'l1'").get() as { segments_json: string }
    const segments = JSON.parse(row.segments_json) as Array<{ at: number; text: string }>
    expect(segments.map((s) => s.at)).toEqual([0, 240])
    expect(segments.every((s) => s.text !== '')).toBe(true)

    // All chunks empty: no speech at all in the lesson audio.
    const audio2 = join(dir, 'audio-silent.wav')
    makeWav(2, audio2)
    stageOutputRow('t1-silent', 'extracting_audio', { audioPath: audio2, durationSeconds: 300 })
    const silent = vi.fn(async () => '   ')
    const silentDeps = makeDeps({ chat: (() => ({ transcribe: silent, chat: async () => 'x' })) as unknown as OrchestratorDeps['chat'] })
    result = await makeTranscribe(silentDeps)({ taskId: 't1-silent', lessonId: 'l1', stage: 'transcribing' })
    expect(result.status).toBe('failed')
    expect((result as { error: string }).error).toContain('没有可识别的语音')
  })

  it('resumes from the transcribing checkpoint without re-uploading completed chunks (review B2)', async () => {
    const audioPath = join(dir, 'audio-ckpt.wav')
    makeWav(2, audioPath)
    stageOutputRow('t1-ckpt', 'extracting_audio', { audioPath, durationSeconds: 300 })
    // Chunks 0 (speech) and 1 (silent) already done from an earlier run.
    stageOutputRow('t1-ckpt', 'transcribing', {
      totalChunks: 3,
      chunks: [
        { index: 0, at: 0, text: '第一段语音' },
        { index: 1, at: 120, text: '' }
      ]
    })
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p1', 'whisper-1')").run()
    const transcribe = vi.fn(async () => '第三段语音')
    const deps = makeDeps({ chat: (() => ({ transcribe, chat: async () => 'x' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeTranscribe(deps)(makeCtx('t1-ckpt'))
    expect(result.status).toBe('ok')
    // Only the missing chunk 2 is uploaded.
    expect(transcribe).toHaveBeenCalledTimes(1)
    const row = db.prepare("SELECT segments_json FROM transcripts WHERE lesson_id = 'l1'").get() as { segments_json: string }
    const segments = JSON.parse(row.segments_json) as Array<{ at: number; text: string }>
    expect(segments.map((sg) => sg.at)).toEqual([0, 240])
    expect(segments.map((sg) => sg.text)).toEqual(['第一段语音', '第三段语音'])
  })
})

describe('makeSummarize multimodal (U4)', () => {
  function seedEvidence(fileCount: number): void {
    const insertPpt = db.prepare('INSERT OR REPLACE INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES (?, ?, ?, ?, ?)')
    for (let i = 0; i < fileCount; i++) {
      const file = join(dir, `ppt-${i}.jpg`)
      writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
      insertPpt.run(`p${i}`, 'l1', i, file, '2026-09-01T00:00:00Z')
    }
    db.prepare(
      "INSERT OR REPLACE INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-01T00:00:00Z')"
    ).run(JSON.stringify([{ at: 0, text: '转写内容' }]))
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'gpt-4o')").run()
  }

  it('cancels mid-summarize through the provider request signal (review D6)', async () => {
    seedEvidence(2)
    const controller = new AbortController()
    const chatJson = vi.fn(async () => {
      controller.abort()
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })
    const deps = makeDeps({ chat: (() => ({ chatJson })) as unknown as OrchestratorDeps['chat'] })
    // The old executor never read ctx.signal — the cancel only landed at
    // the next stage boundary after the whole summarize request returned.
    const result = await makeSummarize(deps)({
      taskId: 't1',
      lessonId: 'l1',
      stage: 'summarizing',
      signal: controller.signal
    })
    expect(result).toEqual({ status: 'failed', error: '任务已取消', kind: 'cancelled' })
  })

  it('embeds real image parts as data URLs, capped at MAX_SUMMARIZE_IMAGES', async () => {
    seedEvidence(25)
    let captured: Array<{ role: string; content: unknown }> = []
    const chatJson = vi.fn(async (messages: unknown[]) => {
      captured = messages as Array<{ role: string; content: unknown }>
      return JSON.stringify(validNote)
    })
    const deps = makeDeps({ chat: (() => ({ chatJson, transcribe: async () => '' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeSummarize(deps)(makeCtx())
    expect(result.status).toBe('ok')
    const userContent = captured.find((m) => m.role === 'user')?.content as Array<{ type: string; imageUrl?: string }>
    const images = userContent.filter((p) => p.type === 'image_url')
    expect(images).toHaveLength(MAX_SUMMARIZE_IMAGES)
    expect(images.every((img) => img.imageUrl?.startsWith('data:image/jpeg;base64,'))).toBe(true)
  })

  it('falls back to a text-only prompt when the provider rejects image input', async () => {
    seedEvidence(2)
    const chatJson = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('unsupported_visual', 'model does not accept image input'))
      .mockResolvedValueOnce(JSON.stringify(validNote))
    const deps = makeDeps({ chat: (() => ({ chatJson, transcribe: async () => '' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeSummarize(deps)(makeCtx())
    expect(result.status).toBe('ok')
    expect(chatJson).toHaveBeenCalledTimes(2)
    const secondUser = chatJson.mock.calls[1]?.[0]?.find((m: { role: string }) => m.role === 'user') as { content: unknown }
    const parts = secondUser.content as Array<{ type: string }>
    expect(parts.every((p) => p.type === 'text')).toBe(true)
  })

  it('surfaces a generic provider failure as a failed stage', async () => {
    seedEvidence(0)
    const chatJson = vi.fn(async () => {
      throw new ProviderError('rate_limit', 'provider rate limit reached')
    })
    const deps = makeDeps({ chat: (() => ({ chatJson, transcribe: async () => '' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeSummarize(deps)(makeCtx())
    expect(result.status).toBe('failed')
  })

  it('captions every image with its evidence id and demands verbatim refs (对齐修复 2026-09-04)', async () => {
    seedEvidence(1)
    const keyframePath = join(dir, 'keyframe-1.jpg')
    writeFileSync(keyframePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    db.prepare(
      'INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('kf-1', 'l1', 45, keyframePath, 'hash-1', '2026-09-01T00:00:00Z')
    let captured: Array<{ role: string; content: unknown }> = []
    const chatJson = vi.fn(async (messages: unknown[]) => {
      captured = messages as Array<{ role: string; content: unknown }>
      return JSON.stringify(validNote)
    })
    const deps = makeDeps({ chat: (() => ({ chatJson, transcribe: async () => '' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeSummarize(deps)(makeCtx())
    expect(result.status).toBe('ok')

    const system = captured.find((m) => m.role === 'system')?.content as string
    expect(system).toContain('原样选用')
    expect(system).toContain('Markdown')

    const userContent = captured.find((m) => m.role === 'user')?.content as Array<{ type: string; text?: string }>
    const captions = userContent.filter((p) => p.type === 'text' && p.text?.startsWith('[图片'))
    expect(captions).toHaveLength(2)
    expect(captions[0]?.text).toContain('证据ID：ppt:0')
    expect(captions[0]?.text).toContain('[图片 1/2]')
    expect(captions[1]?.text).toContain('证据ID：kf:')
    expect(captions[1]?.text).toContain('时间：')

    const closing = userContent.at(-1)
    expect(closing?.type).toBe('text')
    expect(closing?.text).toContain('禁止编造其他文字引用')
  })
})
