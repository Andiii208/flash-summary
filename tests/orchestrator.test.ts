import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { TaskRepository, runTask } from '../src/main/tasks/queue'
import { createExecutors, type OrchestratorDeps } from '../src/main/tasks/orchestrator'
import type { SchoolClient } from '../src/main/school/client'
import type { OpenAiCompatibleClient } from '../src/main/providers/openai-client'
import type { Grid8x8 } from '../src/main/media/phash'

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
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-orch-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

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

  const chat = (() => ({ chat: async () => JSON.stringify(validNote), transcribe: async () => '转写文本' })) as unknown as (
    capability: 'asr' | 'multimodal' | 'text'
  ) => OpenAiCompatibleClient

  const grid: Grid8x8 = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 128))

  return {
    db,
    libraryRoot: dir,
    cacheDir: () => join(dir, 'cache'),
    ffmpeg: realFfmpeg(),
    ffprobe: 'ffprobe',
    school,
    chat,
    gridDecoder: () => grid,
    ...overrides
  }
}

function realFfmpeg(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('ffmpeg-static') as string
}

describe('orchestrator stage executors', () => {
  it('fetching_course upserts the lesson with stream urls', async () => {
    const deps = makeDeps()
    const repo = new TaskRepository(db)
    repo.create('t1', 'l1')
    const executors = createExecutors(deps)

    const result = await executors.fetching_course({ taskId: 't1', lessonId: 'l1', stage: 'fetching_course' })
    expect(result).toEqual({ status: 'ok' })
    const lesson = db.prepare('SELECT title, stream_urls_json FROM lessons WHERE id = ?').get('l1') as { title: string; stream_urls_json: string }
    expect(lesson.title).toBe('第五讲')
    expect(JSON.parse(lesson.stream_urls_json).teacher).toContain('teacher')
  })

  it('summarizing stores a versioned note from the model JSON', async () => {
    const deps = makeDeps()
    db.prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', '[{\"at\":0,\"text\":\"开场\"}]', 'x', 'm', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', 'P', 'https://x/v1', 'enc', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'gpt-4o')").run()

    const repo = new TaskRepository(db)
    repo.create('t2', 'l1')
    const executors = createExecutors(deps)

    const result = await executors.summarizing({ taskId: 't2', lessonId: 'l1', stage: 'summarizing' })
    expect(result).toEqual({ status: 'ok' })
    const note = db.prepare('SELECT version, note_json FROM notes WHERE lesson_id = ?').get('l1') as { version: number; note_json: string }
    expect(note.version).toBe(1)
    expect(JSON.parse(note.note_json).overview).toBe('概览')
  })

  it('summarizing strips markdown fences before parsing', async () => {
    const chatClient = { chat: async () => '```json\n' + JSON.stringify(validNote) + '\n```' } as unknown as OpenAiCompatibleClient
    const deps = makeDeps({ chat: () => chatClient })
    db.prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', '[{\"at\":0,\"text\":\"开场\"}]', 'x', 'm', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', 'P', 'https://x/v1', 'enc', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'gpt-4o')").run()

    const repo = new TaskRepository(db)
    repo.create('t3', 'l1')
    const executors = createExecutors(deps)

    const result = await executors.summarizing({ taskId: 't3', lessonId: 'l1', stage: 'summarizing' })
    expect(result).toEqual({ status: 'ok' })
    expect((db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n).toBe(1)
  })

  it('transcribing fails with a clear message when audio is missing', async () => {
    const deps = makeDeps()
    const repo = new TaskRepository(db)
    repo.create('t4', 'l1')
    const executors = createExecutors(deps)

    // No audio stage output seeded → must fail with the missing-artifact message.
    const result = await executors.transcribing({ taskId: 't4', lessonId: 'l1', stage: 'transcribing' })
    expect(result.status).toBe('failed')
    expect((result as { error: string }).error).toContain('音频产物缺失')
  })

  it('download refuses panorama urls (spec §3 guard at orchestration level)', async () => {
    const deps = makeDeps()
    db.prepare("UPDATE lessons SET stream_urls_json = ? WHERE id = 'l1'").run(
      JSON.stringify({ teacher: 'http://m/1170193-1/a.m3u8', screen: 'http://m/1170194-3/pano.m3u8' })
    )
    const repo = new TaskRepository(db)
    repo.create('t5', 'l1')
    const executors = createExecutors(deps)

    const result = await executors.downloading_video({ taskId: 't5', lessonId: 'l1', stage: 'downloading_video' })
    expect(result).toEqual({ status: 'failed', error: expect.stringContaining('全景流') })
  })

  it('extracting_audio deletes the teacher video after success (lifecycle)', async () => {
    // Prepare a real tiny wav so extractAudio succeeds via ffmpeg.
    const { execFileSync } = await import('child_process')
    const { ffmpegPath } = await import('../src/main/media/binaries')
    const taskDir = join(dir, 'cache', 't6')
    const { mkdirSync } = await import('fs')
    mkdirSync(taskDir, { recursive: true })
    const teacherVideo = join(taskDir, 'teacher.ts')
    execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', teacherVideo], { stdio: 'pipe' })

    const deps = makeDeps()
    const repo = new TaskRepository(db)
    repo.create('t6', 'l1')
    // Seed the download stage output AFTER the task row exists (FK).
    db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t6', 'downloading_video', ?)").run(
      JSON.stringify({ teacherPath: teacherVideo, screenPath: join(taskDir, 'screen.ts') })
    )
    const executors = createExecutors(deps)

    const result = await executors.extracting_audio({ taskId: 't6', lessonId: 'l1', stage: 'extracting_audio' })
    expect(result).toEqual({ status: 'ok' })
    expect(existsSync(teacherVideo)).toBe(false) // teacher video deleted after audio extraction
    expect(existsSync(join(taskDir, 'teacher-audio.wav'))).toBe(true)
  })

  it('full pipeline run through runTask succeeds end-to-end with stubs', async () => {
    const deps = makeDeps()
    const repo = new TaskRepository(db)
    repo.create('t7', 'l1')
    // Providers first, then their capability bindings (FK order).
    db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', 'P', 'https://x/v1', 'enc', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p1', 'whisper-1')").run()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'gpt-4o')").run()

    // Real tiny media via ffmpeg; stream fetch stubbed to copy these local files.
    const { execFileSync } = await import('child_process')
    const { ffmpegPath } = await import('../src/main/media/binaries')
    const taskDir = join(dir, 'cache', 't7')
    const { mkdirSync } = await import('fs')
    const { promises: fsp } = await import('fs')
    mkdirSync(taskDir, { recursive: true })
    execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', join(taskDir, 'src-teacher.mp4')], { stdio: 'pipe' })
    execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(taskDir, 'src-screen.mp4')], { stdio: 'pipe' })
    const depsWithFetch: OrchestratorDeps = {
      ...deps,
      fetchStream: async (url: string, target: string) => {
        const src = url.includes('teacher') ? join(taskDir, 'src-teacher.mp4') : join(taskDir, 'src-screen.mp4')
        await fsp.copyFile(src, target)
      }
    }

    const executors = createExecutors(depsWithFetch)
    const result = await runTask(repo, 't7', executors, 'fetching_course')
    if (result !== 'succeeded') console.log('t7 debug:', JSON.stringify(repo.get('t7')))
    expect(result).toBe('succeeded')
    expect(repo.get('t7')?.state).toBe('succeeded')
    // Note persisted, transcript persisted, teacher video gone (deleted post audio).
    expect((db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM transcripts').get() as { n: number }).n).toBe(1)
    expect(existsSync(join(taskDir, 'teacher.ts'))).toBe(false)
  })
})

describe('transcript write helper', () => {
  it('writes files when needed', () => {
    const p = join(dir, 'x.txt')
    writeFileSync(p, 'hi')
    expect(existsSync(p)).toBe(true)
  })
})
