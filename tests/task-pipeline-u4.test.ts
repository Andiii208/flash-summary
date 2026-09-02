import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { openDatabase, type Db } from '../src/main/db/open'
import { makeTranscribe, makeSummarize, MAX_SUMMARIZE_IMAGES, type OrchestratorDeps } from '../src/main/tasks/orchestrator'
import type { StageContext } from '../src/main/tasks/queue'
import type { SchoolClient } from '../src/main/school/client'
import type { Grid8x8 } from '../src/main/media/phash'
import { ffmpegPath } from '../src/main/media/binaries'
import { DEFAULT_CHUNK_SECONDS } from '../src/main/media/audio-split'
import { ProviderError } from '../src/main/providers/openai-client'

const validNote = {
  overview: '概览',
  knowledgeTree: { title: 'root', children: [] },
  methodology: '方法',
  examCues: [],
  questionsAndGaps: []
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
    "INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES (?, 'l1', 'pending', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')"
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

  it('embeds real image parts as data URLs, capped at MAX_SUMMARIZE_IMAGES', async () => {
    seedEvidence(25)
    let captured: Array<{ role: string; content: unknown }> = []
    const chat = vi.fn(async (messages: unknown[]) => {
      captured = messages as Array<{ role: string; content: unknown }>
      return JSON.stringify(validNote)
    })
    const deps = makeDeps({ chat: (() => ({ chat, transcribe: async () => '' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeSummarize(deps)(makeCtx())
    expect(result.status).toBe('ok')
    const userContent = captured.find((m) => m.role === 'user')?.content as Array<{ type: string; imageUrl?: string }>
    const images = userContent.filter((p) => p.type === 'image_url')
    expect(images).toHaveLength(MAX_SUMMARIZE_IMAGES)
    expect(images.every((img) => img.imageUrl?.startsWith('data:image/jpeg;base64,'))).toBe(true)
  })

  it('falls back to a text-only prompt when the provider rejects image input', async () => {
    seedEvidence(2)
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('unsupported_visual', 'model does not accept image input'))
      .mockResolvedValueOnce(JSON.stringify(validNote))
    const deps = makeDeps({ chat: (() => ({ chat, transcribe: async () => '' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeSummarize(deps)(makeCtx())
    expect(result.status).toBe('ok')
    expect(chat).toHaveBeenCalledTimes(2)
    const secondUser = chat.mock.calls[1]?.[0]?.find((m: { role: string }) => m.role === 'user') as { content: unknown }
    const parts = secondUser.content as Array<{ type: string }>
    expect(parts.every((p) => p.type === 'text')).toBe(true)
  })

  it('surfaces a generic provider failure as a failed stage', async () => {
    seedEvidence(0)
    const chat = vi.fn(async () => {
      throw new ProviderError('rate_limit', 'provider rate limit reached')
    })
    const deps = makeDeps({ chat: (() => ({ chat, transcribe: async () => '' })) as unknown as OrchestratorDeps['chat'] })
    const result = await makeSummarize(deps)(makeCtx())
    expect(result.status).toBe('failed')
  })
})
