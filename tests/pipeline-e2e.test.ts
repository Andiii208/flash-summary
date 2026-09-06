import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { migrate } from '../src/main/db/migrate'
import { ffmpegPath, ffprobePath } from '../src/main/media/binaries'
import { decodeGrid8x8 } from '../src/main/media/grid'
import { SchoolClient } from '../src/main/school/client'
import { BilibiliClient } from '../src/main/bilibili/client'
import { fetchBilibiliLesson } from '../src/main/bilibili/pipeline'
import { OpenAiCompatibleClient } from '../src/main/providers/openai-client'
import { createExecutors } from '../src/main/tasks/orchestrator'
import { TaskRepository, runTask, type TaskProgress } from '../src/main/tasks/queue'
import { parseNote } from '../src/shared/notes/schema'
import { resolveLibraryPath } from '../src/main/library/paths'

/**
 * Combined audit L3 (2026-09-02): the ONLY test that runs the whole six-stage
 * pipeline as one assembled system. Real ffmpeg synthesizes the "recording";
 * a local http server plays the school API, the media server, and an
 * OpenAI-compatible provider; everything between them (download remux, audio
 * extraction, chunking, keyframe dedupe over real jpegs, note parse, DB
 * writes) is production code.
 */

const LESSON_ID = 'l-e2e'
const COURSE_ID = 'c-e2e'
const NOTE_JSON = JSON.stringify({
  overview: '端到端概览',
  knowledgeTree: { title: '根', children: [{ title: '叶子', children: [] }] },
  timeline: [{ at: 0, title: '开场', detail: 'd', refs: [], evidence: [] }],
  concepts: [{ term: '极限', definition: '定义', refs: [] }],
  formulasAndSteps: [],
  methodology: '方法论',
  examCues: ['考点一'],
  questionsAndGaps: ['疑问一'],
  transcriptRefs: [{ at: 0, text: '片段' }],
  evidence: []
})

let mediaDir: string
let libraryDir: string
let cacheDir: string
let server: Server | null = null
let port = 0
let seen: Array<{ method: string; url: string }> = []

beforeAll(() => {
  // Real recordings: 21s test pattern + tone, MPEG-TS so the pipeline's
  // default stream fetch (ffmpeg -c copy over http) has a real stream to
  // pull. 21s because extractKeyframes samples at fps=1/10 and a shorter
  // clip would legitimately produce zero keyframes.
  mediaDir = mkdtempSync(join(tmpdir(), 'seu-e2e-media-'))
  const base = ['-y', '-loglevel', 'error']
  execFileSync(
    ffmpegPath(),
    [...base, '-f', 'lavfi', '-i', 'testsrc=duration=21:size=320x240:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=21', '-c:v', 'mpeg2video', '-c:a', 'aac', '-f', 'mpegts', join(mediaDir, 'teacher.ts')]
  )
  execFileSync(
    ffmpegPath(),
    [...base, '-f', 'lavfi', '-i', 'testsrc=duration=21:size=320x240:rate=10', '-c:v', 'mpeg2video', '-f', 'mpegts', join(mediaDir, 'screen.ts')]
  )
  expect(existsSync(join(mediaDir, 'teacher.ts'))).toBe(true)
  expect(existsSync(join(mediaDir, 'screen.ts'))).toBe(true)
})

afterAll(() => {
  rmSync(mediaDir, { recursive: true, force: true })
})

beforeEach(async () => {
  libraryDir = mkdtempSync(join(tmpdir(), 'seu-e2e-lib-'))
  cacheDir = mkdtempSync(join(tmpdir(), 'seu-e2e-cache-'))
  seen = []
  await new Promise<void>((resolve) => {
    server = createServer(handle)
    server.listen(0, '127.0.0.1', () => {
      port = (server!.address() as { port: number }).port
      resolve()
    })
  })
})

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? ''
  seen.push({ method: req.method ?? '', url })

  if (url === '/jy-application-resourcemanage/v1/course/rec/l-e2e') {
    // Panorama URL is deliberately offered: the pipeline must NEVER fetch it.
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        data: {
          id: LESSON_ID,
          title: '端到端课时',
          duration: 2,
          playUrls: [
            { type: '1170193-1', url: `http://127.0.0.1:${port}/media/teacher.ts` },
            { type: '1170195-5', url: `http://127.0.0.1:${port}/media/screen.ts` },
            { type: '1170194-3', url: `http://127.0.0.1:${port}/media/PANORAMA-MUST-NOT-FETCH.ts` }
          ]
        }
      })
    )
    return
  }
  if (url.startsWith('/jy-application-resourcemanage/v1/course/ai/ppt')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('[]')
    return
  }
  if (url === '/media/teacher.ts' || url === '/media/screen.ts') {
    const file = join(mediaDir, url.slice('/media/'.length))
    res.writeHead(200, { 'content-type': 'video/mp2t' })
    res.end(readFileSync(file))
    return
  }
  if (url === '/audio/transcriptions' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ text: '端到端转写片段一 端到端转写片段二' }))
    return
  }
  // Bilibili source e2e (plan 2026-09-06 M4): the fake API plane.
  if (url.startsWith('/bapi/x/web-interface/view?bvid=BV1E2E00000')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        code: 0,
        data: {
          bvid: 'BV1E2E00000',
          title: 'B站端到端课程',
          pic: 'https://i0.hdslb.com/e2e.jpg',
          cid: 777,
          duration: 21,
          rights: { is_ugc_pay: 0 },
          owner: { mid: 7 },
          pages: [{ page: 1, cid: 777, part: 'E2E P1', duration: 21 }]
        }
      })
    )
    return
  }
  if (url.startsWith('/bapi/x/player/wbi/v2?bvid=BV1E2E00000&cid=777')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    const subtitles = bilibiliE2eWithSubtitle
      ? [{ lan: 'ai-zh', ai_type: 1, subtitle_url: `http://127.0.0.1:${port}/bsubtitle.json` }]
      : []
    res.end(JSON.stringify({ code: 0, data: { need_login_subtitle: true, subtitle: { subtitles } } }))
    return
  }
  if (url === '/bsubtitle.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ body: [{ from: 0.5, to: 2.4, content: 'B站字幕片段一' }, { from: 2.4, to: 5, content: 'B站字幕片段二' }] }))
    return
  }
  if (url.startsWith('/bapi/x/web-interface/nav')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: -101, data: { wbi_img: { img_url: `http://127.0.0.1:${port}/wbi/a1.png`, sub_url: `http://127.0.0.1:${port}/wbi/b2.png` } } }))
    return
  }
  if (url.startsWith('/bapi/x/player/wbi/playurl')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        code: 0,
        data: {
          quality: 32,
          dash: {
            video: [{ id: 32, baseUrl: `http://127.0.0.1:${port}/media/teacher.ts`, codecs: 'avc1', bandwidth: 800000 }],
            audio: [{ id: 30216, baseUrl: `http://127.0.0.1:${port}/media/teacher.ts`, codecs: 'mp4a.40.5', bandwidth: 64000 }]
          }
        }
      })
    )
    return
  }
  if (url === '/chat/completions' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: NOTE_JSON } }] }))
    return
  }
  res.writeHead(404)
  res.end('not found')
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server == null) return resolve()
    server.close(() => resolve())
    server.closeAllConnections()
  })
  server = null
  rmSync(libraryDir, { recursive: true, force: true, maxRetries: 5 })
  rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5 })
})

describe('six-stage pipeline end to end (real http + ffmpeg + provider wire format)', () => {
  it('runs fetching → download → audio → ASR → visuals → summarize to a stored note', async () => {
    const db: Db = openDatabase(join(libraryDir, 'app.db'))
    migrate(db)
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES (?, '端到端课程', '2026-09-02T00:00:00Z')").run(COURSE_ID)
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES (?, ?, '占位', '2026-09-02T00:00:00Z')").run(LESSON_ID, COURSE_ID)
    db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p-e2e', 'Mock', ?, 'sealed', '2026-09-02T00:00:00Z')").run(`http://127.0.0.1:${port}`)
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p-e2e', 'whisper-e2e')").run()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p-e2e', 'vision-e2e')").run()

    const school = new SchoolClient(
      `http://127.0.0.1:${port}/jy-application-resourcemanage`,
      async () => 'JSESSIONID=e2e',
      (url, init) => globalThis.fetch(url, init as RequestInit),
      async () => 'jwt-e2e'
    )
    const chat = (): OpenAiCompatibleClient => new OpenAiCompatibleClient(`http://127.0.0.1:${port}`, 'sk-e2e')
    const executors = createExecutors({
      db,
      libraryRoot: libraryDir,
      cacheDir: () => cacheDir,
      ffmpeg: ffmpegPath(),
      ffprobe: ffprobePath(),
      school,
      chat,
      gridDecoder: decodeGrid8x8
    })

    const repo = new TaskRepository(db)
    repo.create('task-e2e', LESSON_ID)
    const events: TaskProgress[] = []
    try {
      const result = await runTask(
        repo,
        'task-e2e',
        executors,
        'fetching_course',
        (p) => events.push(p)
      )
      expect(result).toBe('succeeded')

    // Progress: every stage plus the terminal event, ending at 100%.
    expect(events.map((e) => e.state)).toEqual([
      'fetching_course', 'downloading_video', 'extracting_audio', 'transcribing', 'extracting_visuals', 'summarizing', 'succeeded'
    ])
    expect(events[events.length - 1].percent).toBe(100)

    // Task row + five stage outputs persisted: the fetching_course URL
    // handoff (full signed URLs) is cleared on success per the red line
    // (review A3, 2026-09-05) — lessons keeps sanitized paths only.
    expect(repo.get('task-e2e')?.state).toBe('succeeded')
    const stageRows = db.prepare('SELECT stage FROM task_stage_outputs WHERE task_id = ? ORDER BY rowid').all('task-e2e') as Array<{ stage: string }>
    expect(stageRows.map((r) => r.stage)).toEqual([
      'downloading_video', 'extracting_audio', 'transcribing', 'extracting_visuals', 'summarizing'
    ])

      // Lesson row carries the fetched stream URLs (panorama never stored as playable).
      const lesson = db.prepare('SELECT title, duration_seconds, stream_urls_json FROM lessons WHERE id = ?').get(LESSON_ID) as {
        title: string
        duration_seconds: number | null
        stream_urls_json: string
      }
      expect(lesson.title).toBe('端到端课时')
      expect(lesson.duration_seconds).toBeGreaterThan(0)
      expect(lesson.stream_urls_json).not.toContain('PANORAMA')

      // Transcript landed; temporary audio was deleted after success (spec §7).
      const transcript = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(LESSON_ID) as { segments_json: string }
      expect(JSON.parse(transcript.segments_json)).toEqual([{ at: 0, text: '端到端转写片段一 端到端转写片段二' }])
      const taskCache = join(cacheDir, 'task-e2e')
      expect(existsSync(taskCache) ? readdirSync(taskCache).filter((f) => f.endsWith('.wav')) : []).toEqual([])

      // Keyframes deduped into the library attachments dir with real jpeg files.
      const kfRows = db.prepare('SELECT file_path FROM keyframes WHERE lesson_id = ?').all(LESSON_ID) as Array<{ file_path: string }>
      expect(kfRows.length).toBeGreaterThan(0)
      // Rows store library-RELATIVE paths (review C2) - resolve them.
      for (const row of kfRows) expect(existsSync(resolveLibraryPath(libraryDir, row.file_path))).toBe(true)

      // Note stored and re-parseable through the shared zod schema.
      const noteRow = db.prepare('SELECT note_json, version FROM notes WHERE lesson_id = ?').get(LESSON_ID) as { note_json: string; version: number }
      expect(noteRow.version).toBe(1)
      expect(parseNote(noteRow.note_json).overview).toBe('端到端概览')

      // Provider wire format: the ASR and summarize calls really happened.
      expect(seen.some((s) => s.url === '/audio/transcriptions')).toBe(true)
      expect(seen.some((s) => s.url === '/chat/completions')).toBe(true)

      // Panorama guard across the whole assembled run.
      expect(seen.some((s) => s.url.includes('PANORAMA'))).toBe(false)

      // School endpoint was really hit over the real fetch.
      expect(seen.some((s) => s.url.includes('/v1/course/rec/'))).toBe(true)
    } finally {
      db.close()
    }
  })
})
/** Per-test knob for the fake bilibili player API: subtitle track present or not. */
let bilibiliE2eWithSubtitle = true

describe('bilibili source end to end (plan 2026-09-06 M4)', () => {
  it('subtitle fast path: fetching→download(video)→audio skip→transcribe skip→visuals→summarize, ASR never called', async () => {
    bilibiliE2eWithSubtitle = true
    const db: Db = openDatabase(join(libraryDir, 'app.db'))
    migrate(db)
    db.prepare("INSERT INTO courses (id, name, source, bili_bvid, bili_up_mid, fetched_at) VALUES ('bili-BV1E2E00000', 'B站端到端课程', 'bilibili', 'BV1E2E00000', '7', '2026-09-06T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, fetched_at) VALUES ('bili-BV1E2E00000-P1', 'bili-BV1E2E00000', 'E2E P1', 'bilibili', '777', 1, '2026-09-06T00:00:00Z')").run()
    db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p-e2e', 'Mock', ?, 'sealed', '2026-09-06T00:00:00Z')").run(`http://127.0.0.1:${port}`)
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p-e2e', 'whisper-e2e')").run()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p-e2e', 'vision-e2e')").run()

    const bilibili = new BilibiliClient(
      async () => 'SESSDATA=e2e',
      (url, init) => globalThis.fetch(url, init as RequestInit),
      30_000,
      `http://127.0.0.1:${port}/bapi`,
      `http://127.0.0.1:${port}/bapi`
    )
    const chat = (): OpenAiCompatibleClient => new OpenAiCompatibleClient(`http://127.0.0.1:${port}`, 'sk-e2e')
    const executors = createExecutors({
      db,
      libraryRoot: libraryDir,
      cacheDir: () => cacheDir,
      ffmpeg: ffmpegPath(),
      ffprobe: ffprobePath(),
      school: new SchoolClient(`http://127.0.0.1:${port}/jy-application-resourcemanage`, async () => '', (url, init) => globalThis.fetch(url, init as RequestInit)),
      chat,
      gridDecoder: decodeGrid8x8,
      fetchBilibili: ({ bvid, page, signal }) => fetchBilibiliLesson(bilibili, bvid, page, signal)
    })

    const repo = new TaskRepository(db)
    repo.create('task-bili', 'bili-BV1E2E00000-P1')
    const events: TaskProgress[] = []
    try {
      const result = await runTask(repo, 'task-bili', executors, 'fetching_course', (p) => events.push(p))
      expect(result).toBe('succeeded')
      expect(events.map((e) => e.state)).toEqual([
        'fetching_course', 'downloading_video', 'extracting_audio', 'transcribing', 'extracting_visuals', 'summarizing', 'succeeded'
      ])

      // Subtitle fast path: provider reflects the bypass source, segments
      // come from the fake subtitle file (not from ASR).
      const transcript = db.prepare('SELECT segments_json, provider FROM transcripts WHERE lesson_id = ?').get('bili-BV1E2E00000-P1') as { segments_json: string; provider: string }
      expect(transcript.provider).toBe('bilibili-subtitle')
      expect(JSON.parse(transcript.segments_json)).toEqual([
        { at: 1, text: 'B站字幕片段一' },
        { at: 2, text: 'B站字幕片段二' }
      ])
      expect(seen.some((s) => s.url === '/audio/transcriptions')).toBe(false)

      // Video downloaded once for keyframes and deleted after extraction.
      const kfRows = db.prepare('SELECT file_path FROM keyframes WHERE lesson_id = ?').all('bili-BV1E2E00000-P1') as Array<{ file_path: string }>
      expect(kfRows.length).toBeGreaterThan(0)
      expect(existsSync(join(cacheDir, 'task-bili', 'video.ts'))).toBe(false)

      // Stage outputs: audio skip + transcribe bypass markers recorded.
      const stageRows = db.prepare('SELECT stage, output_json FROM task_stage_outputs WHERE task_id = ? ORDER BY rowid').all('task-bili') as Array<{ stage: string; output_json: string }>
      const byStage = Object.fromEntries(stageRows.map((r) => [r.stage, JSON.parse(r.output_json) as Record<string, unknown>]))
      expect(byStage['extracting_audio']).toMatchObject({ skipped: 'bilibili-subtitle' })
      expect(byStage['transcribing']).toMatchObject({ bypass: 'bilibili-subtitle' })

      // The signed fetching handoff is cleared on success (red line holds for bilibili too).
      expect(stageRows.some((r) => r.stage === 'fetching_course')).toBe(false)
      expect(stageRows.some((r) => r.output_json.includes('videoStreamUrl'))).toBe(false)

      // Note stored via the normal summarize path.
      const noteRow = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ?').get('bili-BV1E2E00000-P1') as { note_json: string }
      expect(parseNote(noteRow.note_json).overview).toBe('端到端概览')
      expect(seen.some((s) => s.url === '/chat/completions')).toBe(true)
    } finally {
      db.close()
    }
  })

  it('no subtitle: downloads video+audio, ASR fallback runs, note still lands', async () => {
    bilibiliE2eWithSubtitle = false
    const db: Db = openDatabase(join(libraryDir, 'app.db'))
    migrate(db)
    db.prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('bili-BV1E2E00000', 'B站端到端课程', 'bilibili', 'BV1E2E00000', '2026-09-06T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, fetched_at) VALUES ('bili-BV1E2E00000-P1', 'bili-BV1E2E00000', 'E2E P1', 'bilibili', '777', 1, '2026-09-06T00:00:00Z')").run()
    db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p-e2e', 'Mock', ?, 'sealed', '2026-09-06T00:00:00Z')").run(`http://127.0.0.1:${port}`)
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('asr', 'p-e2e', 'whisper-e2e')").run()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p-e2e', 'vision-e2e')").run()

    const bilibili = new BilibiliClient(
      async () => 'SESSDATA=e2e',
      (url, init) => globalThis.fetch(url, init as RequestInit),
      30_000,
      `http://127.0.0.1:${port}/bapi`,
      `http://127.0.0.1:${port}/bapi`
    )
    const chat = (): OpenAiCompatibleClient => new OpenAiCompatibleClient(`http://127.0.0.1:${port}`, 'sk-e2e')
    const executors = createExecutors({
      db,
      libraryRoot: libraryDir,
      cacheDir: () => cacheDir,
      ffmpeg: ffmpegPath(),
      ffprobe: ffprobePath(),
      school: new SchoolClient(`http://127.0.0.1:${port}/jy-application-resourcemanage`, async () => '', (url, init) => globalThis.fetch(url, init as RequestInit)),
      chat,
      gridDecoder: decodeGrid8x8,
      fetchBilibili: ({ bvid, page, signal }) => fetchBilibiliLesson(bilibili, bvid, page, signal)
    })

    const repo = new TaskRepository(db)
    repo.create('task-bili2', 'bili-BV1E2E00000-P1')
    const events: TaskProgress[] = []
    try {
      const result = await runTask(repo, 'task-bili2', executors, 'fetching_course', (p) => events.push(p))
      expect(result).toBe('succeeded')
      expect(events.map((e) => e.state)).toEqual([
        'fetching_course', 'downloading_video', 'extracting_audio', 'transcribing', 'extracting_visuals', 'summarizing', 'succeeded'
      ])

      // ASR fallback really ran; the provider row is the ASR source.
      expect(seen.some((s) => s.url === '/audio/transcriptions')).toBe(true)
      const transcript = db.prepare('SELECT segments_json, provider FROM transcripts WHERE lesson_id = ?').get('bili-BV1E2E00000-P1') as { segments_json: string; provider: string }
      expect(transcript.provider).toBe('openai-compatible')
      expect(JSON.parse(transcript.segments_json)[0].text).toContain('端到端转写片段')

      // Both media files consumed and cleaned up.
      expect(existsSync(join(cacheDir, 'task-bili2', 'video.ts'))).toBe(false)
      expect(existsSync(join(cacheDir, 'task-bili2', 'audio.ts'))).toBe(false)
      const noteRow = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ?').get('bili-BV1E2E00000-P1') as { note_json: string }
      expect(parseNote(noteRow.note_json).overview).toBe('端到端概览')
    } finally {
      db.close()
    }
  })
})
