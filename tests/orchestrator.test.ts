import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { TaskRepository, runTask } from '../src/main/tasks/queue'
import { createExecutors, streamFetchArgs, type OrchestratorDeps } from '../src/main/tasks/orchestrator'
import type { SchoolClient } from '../src/main/school/client'
import type { OpenAiCompatibleClient } from '../src/main/providers/openai-client'
import type { Grid8x8 } from '../src/shared/phash'

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

  const chat = (() => ({ chat: async () => JSON.stringify(validNote), chatJson: async () => JSON.stringify(validNote), transcribe: async () => '转写文本' })) as unknown as (
    capability: 'asr' | 'multimodal' | 'text'
  ) => OpenAiCompatibleClient

  const grid: Grid8x8 = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 128))

  return {
    db,
    libraryRoot: dir,
    cacheDir: () => join(dir, 'cache'),
    ffmpeg: realFfmpeg(),
    ffprobe: realFfprobe(),
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

function realFfprobe(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('ffprobe-static') as { path: string }).path
}

function seedFetchingHandoff(taskId: string): void {
  db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, 'fetching_course', ?)").run(taskId, JSON.stringify({
    lessonId: 'l1',
    teacherStreamUrl: 'https://dncvsvod/teacher.mp4?auth_key=live-token',
    screenStreamUrl: 'https://dncvsvod/screen.mp4?auth_key=live-token'
  }))
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

  it('legacy path keeps signed URLs out of the lessons table but hands them to downloading (red line)', async () => {
    const deps = makeDeps({
      school: {
        lessonDetail: async () => ({
          id: 'l1',
          courseId: 'c1',
          title: '第五讲',
          teacherStreamUrl: 'https://dncvsvod.seu.edu.cn/vod4/teacher.mp4?auth_key=secret-t1',
          screenStreamUrl: 'https://dncvsvod.seu.edu.cn/vod4/screen.mp4?auth_key=secret-t2'
        }),
        listPpt: async () => []
      } as unknown as SchoolClient
    })
    const repo = new TaskRepository(db)
    repo.create('t-legacy', 'l1')
    const executors = createExecutors(deps)

    const result = await executors.fetching_course({ taskId: 't-legacy', lessonId: 'l1', stage: 'fetching_course' })
    expect(result).toEqual({ status: 'ok' })

    // lessons table: sanitized paths only (no auth_key ever).
    const lesson = db.prepare('SELECT stream_urls_json FROM lessons WHERE id = ?').get('l1') as { stream_urls_json: string }
    const stored = JSON.parse(lesson.stream_urls_json) as { teacher: string; screen: string }
    expect(stored.teacher).toBe('https://dncvsvod.seu.edu.cn/vod4/teacher.mp4')
    expect(stored.screen).toBe('https://dncvsvod.seu.edu.cn/vod4/screen.mp4')
    expect(lesson.stream_urls_json).not.toContain('auth_key')

    // stage output: full signed URLs for the download stage only.
    const row = db
      .prepare("SELECT output_json FROM task_stage_outputs WHERE task_id = ? AND stage = 'fetching_course'")
      .get('t-legacy') as { output_json: string }
    const handoff = JSON.parse(row.output_json) as { teacherStreamUrl: string; screenStreamUrl: string }
    expect(handoff.teacherStreamUrl).toContain('auth_key=secret-t1')
    expect(handoff.screenStreamUrl).toContain('auth_key=secret-t2')
  })

  it('fetching_course uses the play-page harvest when the course has tecl refs', async () => {
    db.prepare("UPDATE courses SET tecl_id = '154717', tecl_code = '202620271B080329101' WHERE id = 'c1'").run()
    const harvested: Array<{ ref: string | null }> = []
    const deps = makeDeps({
      harvestLesson: async (input) => {
        harvested.push({ ref: input.selectLessonRef })
        return {
          teacherStreamUrl: 'https://dncvsvod.seu.edu.cn/vod4/SVR-CLOUD-c1-1170193-1.mp4?auth_key=secret-t1',
          screenStreamUrl: 'https://dncvsvod.seu.edu.cn/vod4/SVR-CLOUD-c1-1170195-5.mp4?auth_key=secret-t2',
          lessons: [
            { index: 0, title: '第1节课', ref: '0' },
            { index: 1, title: '第2节课', ref: '1' }
          ]
        }
      }
    })
    const repo = new TaskRepository(db)
    repo.create('t-h', 'l1')
    const executors = createExecutors(deps)

    const result = await executors.fetching_course({ taskId: 't-h', lessonId: 'l1', stage: 'fetching_course' })
    expect(result).toEqual({ status: 'ok' })
    expect(harvested).toEqual([{ ref: null }])

    // Durable row: sanitized paths only — the auth_key must never land here.
    const lesson = db.prepare('SELECT stream_urls_json FROM lessons WHERE id = ?').get('l1') as { stream_urls_json: string }
    const stored = JSON.parse(lesson.stream_urls_json) as { teacher: string; screen: string }
    expect(stored.teacher).toBe('https://dncvsvod.seu.edu.cn/vod4/SVR-CLOUD-c1-1170193-1.mp4')
    expect(stored.screen).not.toContain('auth_key')

    // Stage handoff: full signed URLs for the download stage.
    const stageRow = db
      .prepare("SELECT output_json FROM task_stage_outputs WHERE task_id = 't-h' AND stage = 'fetching_course'")
      .get() as { output_json: string }
    const handoff = JSON.parse(stageRow.output_json) as { teacherStreamUrl: string }
    expect(handoff.teacherStreamUrl).toContain('auth_key')

    // Catalog refresh upserts sibling lessons with play_ref.
    const siblings = db.prepare("SELECT id, play_ref FROM lessons WHERE course_id = 'c1' ORDER BY id").all() as Array<{ id: string; play_ref: string | null }>
    expect(siblings.map((s) => s.id)).toEqual(['c1-L0', 'c1-L1', 'l1'])
  })

  it('fetching_course passes the lesson play_ref so the harvest selects the entry', async () => {
    db.prepare("UPDATE courses SET tecl_id = '154717', tecl_code = '202620271B080329101' WHERE id = 'c1'").run()
    db.prepare("UPDATE lessons SET play_ref = '3' WHERE id = 'l1'").run()
    const refs: Array<string | null> = []
    const deps = makeDeps({
      harvestLesson: async (input) => {
        refs.push(input.selectLessonRef)
        return {
          teacherStreamUrl: 'https://vod/t.mp4?auth_key=x',
          screenStreamUrl: 'https://vod/s.mp4?auth_key=y',
          lessons: []
        }
      }
    })
    const repo = new TaskRepository(db)
    repo.create('t-ref', 'l1')
    const executors = createExecutors(deps)
    await executors.fetching_course({ taskId: 't-ref', lessonId: 'l1', stage: 'fetching_course' })
    expect(refs).toEqual(['3'])
  })

  it('downloading_video prefers the fetching stage output over the stored (sanitized) urls', async () => {
    const deps = makeDeps()
    const repo = new TaskRepository(db)
    repo.create('t-dl', 'l1')
    // Simulate a V1 harvest handoff: signed URLs in the stage output only.
    db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t-dl', 'fetching_course', ?)").run(
      JSON.stringify({
        lessonId: 'l1',
        teacherStreamUrl: 'https://dncvsvod/t.mp4?auth_key=live-token',
        screenStreamUrl: 'https://dncvsvod/s.mp4?auth_key=live-token'
      })
    )
    db.prepare("UPDATE lessons SET stream_urls_json = ? WHERE id = 'l1'").run(
      JSON.stringify({ teacher: 'https://dncvsvod/t.mp4', screen: 'https://dncvsvod/s.mp4' })
    )
    const seen: string[] = []
    const executors = createExecutors({
      ...deps,
      fetchStream: async (url) => {
        seen.push(url)
      }
    })

    const result = await executors.downloading_video({ taskId: 't-dl', lessonId: 'l1', stage: 'downloading_video' })
    expect(result).toEqual({ status: 'ok' })
    expect(seen).toEqual(['https://dncvsvod/t.mp4?auth_key=live-token', 'https://dncvsvod/s.mp4?auth_key=live-token'])
  })

  it('downloading_video skips a markered stream and only re-fetches the failed one (review B3)', async () => {
    const fetched: string[] = []
    const deps = makeDeps({
      fetchStream: async (url, target) => {
        fetched.push(url)
        writeFileSync(target, 'stream-bytes')
      }
    })
    const repo = new TaskRepository(db)
    repo.create('t-dl2', 'l1')
    const taskDir = join(deps.cacheDir(), 't-dl2')
    mkdirSync(taskDir, { recursive: true })
    // Teacher stream completed in an earlier run (file + .ok marker).
    writeFileSync(join(taskDir, 'teacher.ts'), 'old-bytes')
    writeFileSync(join(taskDir, 'teacher.ts.ok'), '')
    seedFetchingHandoff('t-dl2')
    const executors = createExecutors(deps)
    const result = await executors.downloading_video({ taskId: 't-dl2', lessonId: 'l1', stage: 'downloading_video' })
    expect(result).toEqual({ status: 'ok' })
    expect(fetched).toHaveLength(1)
    expect(fetched[0]).toContain('screen')
    // Both markers exist after success; the screen marker is new.
    expect(existsSync(join(taskDir, 'screen.ts.ok'))).toBe(true)
    expect(existsSync(join(taskDir, 'teacher.ts.ok'))).toBe(true)
  })

  it('downloading_video refuses to start below the free-disk floor (review B6)', async () => {
    const deps = makeDeps({ freeDiskOverride: () => 1024 * 1024 * 1024 })
    const repo = new TaskRepository(db)
    repo.create('t-disk', 'l1')
    seedFetchingHandoff('t-disk')
    const executors = createExecutors(deps)
    const result = await executors.downloading_video({ taskId: 't-disk', lessonId: 'l1', stage: 'downloading_video' })
    expect(result.status).toBe('failed')
    expect((result as { error: string }).error).toContain('磁盘剩余空间不足')
  })

  it('downloading_video proceeds when the free-disk probe is unavailable (review B6)', async () => {
    const deps = makeDeps({ freeDiskOverride: () => null, fetchStream: async (_url, target) => writeFileSync(target, 'x') })
    const repo = new TaskRepository(db)
    repo.create('t-disk2', 'l1')
    seedFetchingHandoff('t-disk2')
    const executors = createExecutors(deps)
    const result = await executors.downloading_video({ taskId: 't-disk2', lessonId: 'l1', stage: 'downloading_video' })
    expect(result.status).toBe('ok')
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
    const chatClient = { chatJson: async () => '```json\n' + JSON.stringify(validNote) + '\n```' } as unknown as OpenAiCompatibleClient
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
    expect(result).toBe('succeeded')
    expect(repo.get('t7')?.state).toBe('succeeded')
    // Note persisted, transcript persisted, teacher video gone (deleted post audio).
    expect((db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM transcripts').get() as { n: number }).n).toBe(1)
    expect(existsSync(join(taskDir, 'teacher.ts'))).toBe(false)
  })

  // 批3 (plan 2026-09-19): 抽帧去重改吃缩略图。gridDecoder 注入缝里换成
  // 生产同款 decodeGridPreferThumb——保留帧集合（去重行为）必须与全分辨率
  // 解码逐帧一致，且缓存目录里确有 thumb-frame-* 产出（双输出真的在跑）。
  it('批3: 抽帧去重走缩略图（prefer-thumb 注入）与全分辨率解码保留结果一致', async () => {
    const { execFileSync } = await import('child_process')
    const { ffmpegPath } = await import('../src/main/media/binaries')
    const { decodeGrid8x8, decodeGridPreferThumb } = await import('../src/main/media/grid')
    const { hammingDistance } = await import('../src/shared/phash')

    const runVisuals = async (taskId: string, gridDecoder: (p: string) => Grid8x8) => {
      const deps = makeDeps({ gridDecoder })
      const repo = new TaskRepository(db)
      repo.create(taskId, 'l1')
      const taskDir = join(dir, 'cache', taskId)
      mkdirSync(taskDir, { recursive: true })
      const screen = join(taskDir, 'screen.mp4')
      execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=21:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', screen], { stdio: 'pipe' })
      db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, 'downloading_video', ?)").run(
        taskId,
        JSON.stringify({ teacherPath: screen, screenPath: screen })
      )
      const executors = createExecutors(deps)
      const result = await executors.extracting_visuals({ taskId, lessonId: 'l1', stage: 'extracting_visuals' })
      const rows = db.prepare('SELECT timestamp_seconds, hash FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds').all('l1') as Array<{ timestamp_seconds: number; hash: string }>
      return { result, rows, keyframesDir: join(taskDir, 'keyframes') }
    }

    const full = await runVisuals('t8-full', decodeGrid8x8)
    expect(full.result).toEqual({ status: 'ok' })
    expect(full.rows.length).toBeGreaterThan(1) // 21s @ fps=1/10 → 3 候选，去重后仍有多帧

    const thumb = await runVisuals('t9-thumb', decodeGridPreferThumb)
    expect(thumb.result).toEqual({ status: 'ok' })
    // 去重行为不变：保留帧的时间戳集合逐帧一致。
    expect(thumb.rows.map((r) => r.timestamp_seconds)).toEqual(full.rows.map((r) => r.timestamp_seconds))
    // 哈希在原图与缩略图之间允许保真门内的漂移（≤2/64），实测应更小。
    for (let i = 0; i < full.rows.length; i++) {
      expect(hammingDistance(full.rows[i]!.hash, thumb.rows[i]!.hash)).toBeLessThanOrEqual(2)
    }
    // 批3: 缩略图随帧进库（hashOf 在 summarize 阶段解它，装完即删）；
    // 抽帧缓存目录不残留 thumb-frame-*（只可能剩被去重丢弃帧的缩略图，
    // 随任务缓存清理）。
    const libKfDir = join(dir, 'attachments', 'l1', 'keyframes')
    const libFiles = readdirSync(libKfDir)
    expect(libFiles.filter((f) => f.startsWith('thumb-kf-')).length).toBe(thumb.rows.length)
    expect(libFiles.filter((f) => /^kf-/.test(f)).length).toBe(thumb.rows.length)
  })

  // 批6 (plan 2026-09-19): 重跑防孤儿。同一任务重跑且本次保留帧变少时，
  // 附件目录先整体清空再写——上一次多出的帧（含批3 随帧的缩略图）不会作为
  // 孤儿文件永远留在库里（DB 行有外键与版本管理，磁盘文件此前没有）。
  it('批6: 重跑抽取先清 destDir——帧数变少不留孤儿文件', async () => {
    const { execFileSync } = await import('child_process')
    const { ffmpegPath } = await import('../src/main/media/binaries')

    const taskId = 't6-rerun'
    const repo = new TaskRepository(db)
    repo.create(taskId, 'l1')
    const taskDir = join(dir, 'cache', taskId)
    mkdirSync(taskDir, { recursive: true })
    const longVideo = join(taskDir, 'long.mp4')
    const shortVideo = join(taskDir, 'short.mp4')
    execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=145:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longVideo], { stdio: 'pipe' })
    execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=75:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shortVideo], { stdio: 'pipe' })

    const seedHandoff = (video: string): void => {
      db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, 'downloading_video', ?)").run(
        taskId,
        JSON.stringify({ teacherPath: video, screenPath: video })
      )
    }
    const libKfDir = join(dir, 'attachments', 'l1', 'keyframes')
    const kfFiles = (): string[] => readdirSync(libKfDir).filter((f) => /^kf-/.test(f))
    const rowsWithFileOnDisk = (): number =>
      (db.prepare('SELECT file_path FROM keyframes WHERE lesson_id = ?').all('l1') as Array<{ file_path: string }>).filter((r) =>
        existsSync(join(dir, r.file_path))
      ).length

    const executors = createExecutors(makeDeps())
    seedHandoff(longVideo)
    expect(await executors.extracting_visuals({ taskId, lessonId: 'l1', stage: 'extracting_visuals' })).toEqual({ status: 'ok' })
    const firstRun = kfFiles().length
    expect(firstRun).toBeGreaterThan(1) // 145s @ 20s 间隔 + 覆盖桶 → 5 帧；75s 重跑 → 3 帧

    // 上一次更长抽取留下的孤儿（整改前，帧数变少时它会一直躺在附件库里）。
    writeFileSync(join(libKfDir, 'kf-0099-999s.jpg'), 'orphan-frame')
    writeFileSync(join(libKfDir, 'thumb-kf-0099-999s.jpg'), 'orphan-thumb')

    seedHandoff(shortVideo)
    expect(await executors.extracting_visuals({ taskId, lessonId: 'l1', stage: 'extracting_visuals' })).toEqual({ status: 'ok' })
    expect(kfFiles().length).toBeLessThan(firstRun)
    // 磁盘上没有孤儿：每个 kf 文件都有 DB 行，每个有文件的 DB 行都在盘上。
    expect(kfFiles().length).toBe(rowsWithFileOnDisk())
    expect(readdirSync(libKfDir).filter((f) => f.includes('0099'))).toHaveLength(0)
  })

  // 修复轮 I3: 清盘也要清行。写库前缺 DELETE FROM keyframes WHERE lesson_id=?
  // 时，重跑帧数变少会在 DB 里留下指向已删文件的悬空行——它们会进
  // loadSummarizeInputs 的 allRefs/visualAssets（模型可引用不存在也没发过
  // 的证据）并让 Obsidian 导出的 copyFileSync 抛错。
  it('修复轮 I3: 重跑帧数变少后 DB 行数与盘上文件数一致（无悬空 keyframes 行）', async () => {
    const { execFileSync } = await import('child_process')
    const { ffmpegPath } = await import('../src/main/media/binaries')

    const taskId = 't6-rows'
    const repo = new TaskRepository(db)
    repo.create(taskId, 'l1')
    const taskDir = join(dir, 'cache', taskId)
    mkdirSync(taskDir, { recursive: true })
    const longVideo = join(taskDir, 'long.mp4')
    const shortVideo = join(taskDir, 'short.mp4')
    execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=145:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longVideo], { stdio: 'pipe' })
    execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=75:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shortVideo], { stdio: 'pipe' })

    const seedHandoff = (video: string): void => {
      db.prepare("INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, 'downloading_video', ?)").run(
        taskId,
        JSON.stringify({ teacherPath: video, screenPath: video })
      )
    }
    const rowCount = (): number => (db.prepare('SELECT COUNT(*) AS n FROM keyframes WHERE lesson_id = ?').get('l1') as { n: number }).n
    const libKfDir = join(dir, 'attachments', 'l1', 'keyframes')
    const fileCount = (): number => readdirSync(libKfDir).filter((f) => /^kf-/.test(f)).length

    const executors = createExecutors(makeDeps())
    seedHandoff(longVideo)
    expect(await executors.extracting_visuals({ taskId, lessonId: 'l1', stage: 'extracting_visuals' })).toEqual({ status: 'ok' })
    expect(rowCount()).toBeGreaterThan(1)

    seedHandoff(shortVideo)
    expect(await executors.extracting_visuals({ taskId, lessonId: 'l1', stage: 'extracting_visuals' })).toEqual({ status: 'ok' })
    // DB 行与盘上帧一一对应：没有悬空 ref 能进 allRefs/visualAssets。
    expect(rowCount()).toBe(fileCount())
    expect(rowCount()).toBeLessThan(5)
  })
})

describe('transcript write helper', () => {
  it('writes files when needed', () => {
    const p = join(dir, 'x.txt')
    writeFileSync(p, 'hi')
    expect(existsSync(p)).toBe(true)
  })
})

describe('cancellation semantics (M1-1: cancel must say cancelled)', () => {
  it('a download aborted mid-stage reports cancelled, not a masked failure', async () => {
    const deps = makeDeps({
      fetchStream: (_url: string, _target: string, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
          )
        })
    })
    const repo = new TaskRepository(db)
    repo.create('tc1', 'l1')
    const controller = new AbortController()
    const progress: Array<{ kind?: string; message: string }> = []
    const executors = createExecutors(deps)
    const done = runTask(repo, 'tc1', executors, 'fetching_course', (p) => progress.push(p), controller.signal)
    await new Promise((r) => setTimeout(r, 80))
    controller.abort()
    await done
    const row = repo.get('tc1')
    expect(row?.state).toBe('failed')
    expect(row?.error_kind).toBe('cancelled')
    expect(row?.error_message).toBe('任务已取消')
    expect(progress.at(-1)?.kind).toBe('cancelled')
  })

  it('the transcribe loop honours cancellation between chunks', async () => {
    // Small real wav as the audio artifact (plan claims 240s → 2 chunks).
    const { execFileSync } = await import('child_process')
    const taskDir = join(dir, 'cache', 'tc2')
    const { mkdirSync } = await import('fs')
    mkdirSync(taskDir, { recursive: true })
    const audioPath = join(taskDir, 'teacher-audio.wav')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    execFileSync(require('ffmpeg-static') as string, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', audioPath], { stdio: 'pipe' })
    const repo = new TaskRepository(db)
    repo.create('tc2', 'l1')
    db.prepare(
      'INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)'
    ).run('tc2', 'extracting_audio', JSON.stringify({ audioPath, durationSeconds: 240 }))
    db.prepare("INSERT OR IGNORE INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', '测试', 'https://api.test/v1', 'enc', '2026-08-30T00:00:00Z')").run()
    db.prepare(
      "INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p1', 'asr-model')"
    ).run()

    let transcribeCalls = 0
    const deps = makeDeps({
      chat: (() => ({
        transcribe: async (): Promise<string> => {
          transcribeCalls++
          return '片段'
        },
        chatJson: async () => JSON.stringify(validNote),
        chat: async () => JSON.stringify(validNote)
      })) as unknown as OrchestratorDeps['chat']
    })
    const controller = new AbortController()
    const executors = createExecutors({
      ...deps,
      onChunkProgress: (_ctx, index) => {
        if (index === 1) controller.abort()
      }
    })
    await runTask(repo, 'tc2', executors, 'transcribing', undefined, controller.signal)
    const row = repo.get('tc2')
    expect(row?.state).toBe('failed')
    expect(row?.error_kind).toBe('cancelled')
    expect(transcribeCalls).toBe(1)
  })
})

describe('download progress polling (M1-3)', () => {
  it('reports downloaded bytes while the streams grow on disk', async () => {
    const { copyFile } = await import('fs/promises')
    const taskDir = join(dir, 'cache', 'tp1')
    const { mkdirSync } = await import('fs')
    mkdirSync(taskDir, { recursive: true })
    // Real teacher/screen sources exist from the fixture flow; write the
    // teacher file up front so the poller sees bytes, then hold the screen
    // download long enough for one poll tick.
    const teacherSrc = join(taskDir, 'src-teacher.mp4')
     
    const { execFileSync } = await import('child_process')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    execFileSync(require('ffmpeg-static') as string, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=2', '-c:v', 'libx264', teacherSrc], { stdio: 'pipe' })
    const repo = new TaskRepository(db)
    repo.create('tp1', 'l1')
    db.prepare(
      'INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)'
    ).run('tp1', 'fetching_course', JSON.stringify({ lessonId: 'l1', teacherStreamUrl: 'http://x/teacher', screenStreamUrl: 'http://x/screen' }))

    const progress: Array<{ bytes: number; speed: number }> = []
    const deps = makeDeps({
      fetchStream: async (url: string, target: string) => {
        if (url.includes('teacher')) {
          await copyFile(teacherSrc, target)
          return
        }
        // Hold the second stream so the poller ticks against a live download.
        await new Promise((r) => setTimeout(r, 1600))
        await copyFile(teacherSrc, target)
      },
      onDownloadProgress: (_ctx, bytes, speed) => progress.push({ bytes, speed })
    })
    const executors = createExecutors(deps)
    await executors.downloading_video({ taskId: 'tp1', lessonId: 'l1', stage: 'downloading_video' })
    expect(progress.length).toBeGreaterThanOrEqual(1)
    expect(progress[0]!.bytes).toBeGreaterThan(0)
  })
})

describe('streamFetchArgs (bilibili CDN referer-auth, real-acceptance 2026-09-07)', () => {
  it('sends browser Referer + UA headers — ffmpeg sends neither by default', () => {
    const args = streamFetchArgs('https://cdn.bilivideo.com/x.m4s', join(dir, 'video.ts'))
    const headersIndex = args.indexOf('-headers')
    expect(headersIndex).toBeGreaterThanOrEqual(0)
    const headers = args[headersIndex + 1] ?? ''
    expect(headers).toContain('Referer: https://www.bilibili.com/')
    expect(headers).toContain('User-Agent: Mozilla/5.0')
    expect(args.indexOf('-i')).toBeGreaterThan(headersIndex)
    expect(args).toContain('-c')
    expect(args).toContain('copy')
  })
})
