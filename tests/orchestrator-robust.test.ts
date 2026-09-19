import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { TaskRepository, runTask } from '../src/main/tasks/queue'
import { createExecutors, type OrchestratorDeps } from '../src/main/tasks/orchestrator'
import type { SchoolClient } from '../src/main/school/client'
import type { OpenAiCompatibleClient } from '../src/main/providers/openai-client'
import type { Grid8x8 } from '../src/shared/phash'
import type { StageContext } from '../src/main/tasks/queue'

let db: Db
let dir: string

const validNote = {
  overview: '概览',
  knowledgeTree: { title: 'root', children: [] },
  methodology: '方法',
  examCues: [],
  questionsAndGaps: []
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-orch-robust-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-19T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-19T00:00:00Z')").run()
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function realFfmpeg(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('ffmpeg-static') as string
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const school = {
    lessonDetail: async () => ({
      id: 'l1',
      courseId: 'c1',
      title: '第五讲',
      teacherStreamUrl: 'http://media/teacher.m3u8',
      screenStreamUrl: 'http://media/screen.m3u8'
    }),
    listPpt: async () => []
  } as unknown as SchoolClient

  const chat = (() => ({
    chat: async () => JSON.stringify(validNote),
    chatJson: async () => JSON.stringify(validNote),
    transcribe: async () => '转写文本'
  })) as unknown as (capability: 'asr' | 'multimodal' | 'text') => OpenAiCompatibleClient

  const grid: Grid8x8 = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 128))

  return {
    db,
    libraryRoot: dir,
    cacheDir: () => join(dir, 'cache'),
    ffmpeg: realFfmpeg(),
    ffprobe: realFfmpeg(),
    school,
    chat,
    gridDecoder: () => grid,
    freeDiskOverride: () => 100 * 1024 ** 3,
    ...overrides
  }
}

describe('ASR 取消 (批5)', () => {
  it('abort during the retry backoff lands cancelled at the stage boundary — without waiting out the 5s sleep', async () => {
    vi.useFakeTimers()
    const wavPath = join(dir, 'audio.wav')
    writeFileSync(wavPath, 'RIFFfake')
    const repo = new TaskRepository(db)
    repo.create('t1', 'l1')
    db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t1', 'extracting_audio', ?)").run(
      JSON.stringify({ audioPath: wavPath, durationSeconds: 30 })
    )
    db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', '测试', 'http://x', 'k', '2026-09-19T00:00:00Z')").run()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p1', 'asr-model')").run()

    let transcribeCalls = 0
    const chat = (() => ({
      transcribe: async () => {
        transcribeCalls += 1
        throw Object.assign(new Error('network down'), { kind: 'network' })
      }
    })) as unknown as (capability: 'asr' | 'multimodal' | 'text') => OpenAiCompatibleClient

    const deps = makeDeps({ chat })
    const controller = new AbortController()

    const run = runTask(repo, 't1', createExecutors(deps), 'transcribing', undefined, controller.signal)
    // Let the first attempt fail into the backoff sleep.
    await vi.advanceTimersByTimeAsync(1)
    expect(transcribeCalls).toBe(1)
    controller.abort()

    const result = await run
    expect(result).toBe('failed')
    const row = repo.get('t1')
    expect(row?.state).toBe('failed')
    expect(row?.error_kind).toBe('cancelled')
    // No second attempt after the abort.
    expect(transcribeCalls).toBe(1)
  })
})

describe('ENOSPC 人话报错 (批5)', () => {
  it('a disk-full stream download fails with a human message and leaves the row terminal', async () => {
    vi.useFakeTimers()
    const repo = new TaskRepository(db)
    repo.create('t1', 'l1')
    db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t1', 'fetching_course', ?)").run(
      JSON.stringify({
        lessonId: 'l1',
        teacherStreamUrl: 'https://dncvsvod/teacher.mp4?auth_key=live',
        screenStreamUrl: 'https://dncvsvod/screen.mp4?auth_key=live'
      })
    )
    const deps = makeDeps({
      fetchStream: async (_url: string, target: string) => {
        writeFileSync(target, 'partial')
        throw Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' })
      }
    })

    const run = runTask(repo, 't1', createExecutors(deps), 'downloading_video')
    // 3 attempts with 5s + 15s backoff sleeps.
    await vi.advanceTimersByTimeAsync(21_000)
    const result = await run

    expect(result).toBe('failed')
    const row = repo.get('t1')
    expect(row?.state).toBe('failed')
    expect(String(row?.error_message)).toContain('磁盘')
    expect(String(row?.error_message)).not.toContain('ENOSPC')
  })

  // 终审修复波: B 站下载分支复用 describeDownloadError——此前只有 SEU 分支
  // 人话化，B 站分支裸抛 err.message。同一句「磁盘空间不足」两个分支都要说。
  it('a disk-full bilibili download humanizes ENOSPC the same way (reuses describeDownloadError)', async () => {
    vi.useFakeTimers()
    const repo = new TaskRepository(db)
    repo.create('t2', 'l1')
    db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t2', 'fetching_course', ?)").run(
      JSON.stringify({
        lessonId: 'l1',
        bilibili: true,
        videoStreamUrl: 'https://bili/video.mp4',
        audioStreamUrl: null,
        hasSubtitle: false
      })
    )
    const deps = makeDeps({
      fetchStream: async (_url: string, target: string) => {
        writeFileSync(target, 'partial')
        throw Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' })
      }
    })

    const run = runTask(repo, 't2', createExecutors(deps), 'downloading_video')
    // 3 attempts with 5s + 15s backoff sleeps.
    await vi.advanceTimersByTimeAsync(21_000)
    const result = await run

    expect(result).toBe('failed')
    const row = repo.get('t2')
    expect(row?.state).toBe('failed')
    expect(String(row?.error_message)).toContain('磁盘空间不足')
    expect(String(row?.error_message)).not.toContain('ENOSPC')
  })
})

describe('stageOutput 坏 JSON 兜底 (批5)', () => {
  it('a corrupted stage row degrades to «产物缺失», not a raw JSON parse crash', async () => {
    const repo = new TaskRepository(db)
    repo.create('t1', 'l1')
    db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t1', 'downloading_video', 'not-json{')").run()
    const deps = makeDeps()

    const result = await createExecutors(deps).extracting_audio({ taskId: 't1', lessonId: 'l1', stage: 'extracting_audio' } as StageContext)
    expect(result).toMatchObject({ status: 'failed' })
    expect((result as { error: string }).error).toContain('下载阶段产物缺失')
  })
})
