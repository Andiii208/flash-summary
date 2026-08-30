/**
 * Stage executors wiring pipeline stages to real work (spec §3).
 * All I/O goes through injected deps so tests can stub the network,
 * ffmpeg, and providers while the orchestration logic stays real.
 */
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join, basename } from 'path'
import type { Db } from '../db/open'
import { attachmentsPath, cachePath } from '../library/paths'
import { extractAudio, extractKeyframes, run as runProcess } from '../media/ffmpeg'
import { dedupeKeyframes, type Grid8x8 } from '../media/phash'
import { downloadToFile } from '../media/download'
import type { StageExecutor, StageContext } from './queue'
import type { Stage } from './stages'
import type { SchoolClient } from '../school/client'
import { parseNote, type Note } from '../notes/schema'
import type { OpenAiCompatibleClient } from '../providers/openai-client'

export interface OrchestratorDeps {
  db: Db
  libraryRoot: string
  ffmpeg: string
  ffprobe: string
  school: SchoolClient
  /** Chat client factory for a capability (asr uses its HTTP endpoints). */
  chat: (capability: 'asr' | 'multimodal' | 'text') => OpenAiCompatibleClient
  /** Decodes a jpg into an 8x8 luminance grid for phash. */
  gridDecoder: (path: string) => Grid8x8
  /** Stream fetch: url → local file. Default remuxes via ffmpeg; tests stub it. */
  fetchStream?: (url: string, target: string) => Promise<void>
  now?: () => Date
}

function nowIso(deps: OrchestratorDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString()
}

function taskDir(deps: OrchestratorDeps, taskId: string): string {
  const dir = join(cachePath(deps.libraryRoot), taskId)
  mkdirSync(dir, { recursive: true })
  return dir
}

function recordStage(deps: OrchestratorDeps, taskId: string, stage: Stage, output: unknown): void {
  deps.db
    .prepare('INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)')
    .run(taskId, stage, JSON.stringify(output))
}

function stageOutput<T>(deps: OrchestratorDeps, taskId: string, stage: Stage): T | null {
  const row = deps.db.prepare('SELECT output_json FROM task_stage_outputs WHERE task_id = ? AND stage = ?').get(taskId, stage) as
    | { output_json: string }
    | undefined
  return row != null ? (JSON.parse(row.output_json) as T) : null
}

/**
 * 1. fetching_course — fetch lesson detail from the school API and upsert
 * the lesson row (metadata is retained permanently per spec §7).
 */
export function makeFetchCourse(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    try {
      const lessonRow = deps.db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(ctx.lessonId) as
        | { course_id: string }
        | undefined
      const detail = await deps.school.lessonDetail(ctx.lessonId, lessonRow?.course_id ?? '')

      deps.db
        .prepare(
          `INSERT INTO lessons (id, course_id, title, started_at, duration_seconds, stream_urls_json, ppt_course_id, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, started_at = excluded.started_at,
             duration_seconds = excluded.duration_seconds, stream_urls_json = excluded.stream_urls_json,
             ppt_course_id = excluded.ppt_course_id, fetched_at = excluded.fetched_at`
        )
        .run(
          detail.id,
          detail.courseId,
          detail.title,
          detail.startedAt ?? null,
          detail.durationSeconds ?? null,
          JSON.stringify({ teacher: detail.teacherStreamUrl, screen: detail.screenStreamUrl }),
          detail.pptCourseId ?? null,
          nowIso(deps)
        )
      recordStage(deps, ctx.taskId, ctx.stage, { lessonId: detail.id })
      return { status: 'ok' }
    } catch (err) {
      return { status: 'failed', error: `获取课时信息失败: ${(err as Error).message}` }
    }
  }
}

/** Default stream fetch: remux via ffmpeg (stream copy, no re-encode). */
async function fetchStreamDefault(ffmpeg: string, url: string, target: string): Promise<void> {
  await runProcess(ffmpeg, ['-y', '-i', url, '-c', 'copy', target])
}

/** 2. downloading_video — fetch teacher + screen streams into cache (panorama never). */
export function makeDownload(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    const row = deps.db.prepare('SELECT stream_urls_json FROM lessons WHERE id = ?').get(ctx.lessonId) as
      | { stream_urls_json: string | null }
      | undefined
    const urls = row?.stream_urls_json != null ? (JSON.parse(row.stream_urls_json) as { teacher?: string; screen?: string }) : {}
    if (urls.teacher == null || urls.screen == null) {
      return { status: 'failed', error: '课时缺少教师流或屏幕流地址，无法下载' }
    }
    const dir = taskDir(deps, ctx.taskId)
    try {
      const teacherPath = join(dir, 'teacher.ts')
      const screenPath = join(dir, 'screen.ts')
      // Panorama guard: refuse any URL tagged 1170194-3.
      if (urls.teacher.includes('1170194-3') || urls.screen.includes('1170194-3')) {
        return { status: 'failed', error: '检测到全景流地址（1170194-3），按规格禁止下载' }
      }
      const fetchStream = deps.fetchStream ?? (async (url: string, target: string) => fetchStreamDefault(deps.ffmpeg, url, target))
      await fetchStream(urls.teacher, teacherPath)
      await fetchStream(urls.screen, screenPath)
      recordStage(deps, ctx.taskId, ctx.stage, { teacherPath, screenPath })
      return { status: 'ok' }
    } catch (err) {
      return { status: 'failed', error: `下载视频失败: ${(err as Error).message}` }
    }
  }
}

/** 3. extracting_audio — teacher video → 16k mono wav; teacher video deleted after success. */
export function makeExtractAudio(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    const dl = stageOutput<{ teacherPath: string; screenPath: string }>(deps, ctx.taskId, 'downloading_video')
    if (dl == null) return { status: 'failed', error: '下载阶段产物缺失，需要重新下载' }
    try {
      const dir = taskDir(deps, ctx.taskId)
      const { audioPath, durationSeconds } = await extractAudio(dl.teacherPath, dir, deps.ffmpeg)
      if (existsSync(dl.teacherPath)) rmSync(dl.teacherPath, { force: true })
      recordStage(deps, ctx.taskId, ctx.stage, { audioPath, durationSeconds })
      return { status: 'ok' }
    } catch (err) {
      return { status: 'failed', error: `音频提取失败: ${(err as Error).message}` }
    }
  }
}

/** 4. transcribing — audio → provider ASR → transcript row. */
export function makeTranscribe(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    const audio = stageOutput<{ audioPath: string }>(deps, ctx.taskId, 'extracting_audio')
    if (audio == null) return { status: 'failed', error: '音频产物缺失，需要重新提取' }
    const binding = deps.db
      .prepare("SELECT provider_id, model FROM capability_bindings WHERE capability = 'asr'")
      .get() as { provider_id: string; model: string } | undefined
    if (binding == null) return { status: 'failed', error: '未绑定 ASR 模型，请在设置中配置 ASR Provider' }
    try {
      const client = deps.chat('asr')
      const { readFileSync } = await import('fs')
      const blob = new Blob([readFileSync(audio.audioPath)])
      const text = await client.transcribe(blob, basename(audio.audioPath), binding.model)
      deps.db
        .prepare(
          `INSERT OR REPLACE INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(ctx.lessonId, JSON.stringify([{ at: 0, text }]), 'openai-compatible', binding.model, nowIso(deps))
      // Audio is temporary: delete after successful transcription (spec §7).
      if (existsSync(audio.audioPath)) rmSync(audio.audioPath, { force: true })
      recordStage(deps, ctx.taskId, ctx.stage, { chars: text.length })
      return { status: 'ok' }
    } catch (err) {
      return { status: 'failed', error: `转写失败: ${(err as Error).message}` }
    }
  }
}

/** 5. extracting_visuals — screen video keyframes + platform PPT download. */
export function makeExtractVisuals(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    const dl = stageOutput<{ teacherPath: string; screenPath: string }>(deps, ctx.taskId, 'downloading_video')
    if (dl == null) return { status: 'failed', error: '下载阶段产物缺失，需要重新下载' }
    try {
      const outDir = join(taskDir(deps, ctx.taskId), 'keyframes')
      mkdirSync(outDir, { recursive: true })
      const candidates = await extractKeyframes(dl.screenPath, outDir, 10, deps.ffmpeg)
      const kept = dedupeKeyframes(
        candidates.map((c) => ({ ...c, grid: deps.gridDecoder(c.filePath) })),
        5
      )

      const destDir = join(attachmentsPath(deps.libraryRoot), ctx.lessonId, 'keyframes')
      mkdirSync(destDir, { recursive: true })
      const insertKf = deps.db.prepare(
        'INSERT OR REPLACE INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      for (const [i, frame] of kept.entries()) {
        const dest = join(destDir, `kf-${String(i).padStart(4, '0')}-${Math.round(frame.timestampSeconds)}s.jpg`)
        const { renameSync } = await import('fs')
        renameSync(frame.filePath, dest)
        insertKf.run(`${ctx.lessonId}-kf-${i}`, ctx.lessonId, frame.timestampSeconds, dest, frame.hash, nowIso(deps))
      }
      if (existsSync(dl.screenPath)) rmSync(dl.screenPath, { force: true })

      // Platform PPT: primary visual source (best-effort; absence is not fatal).
      let pptCount = 0
      const lessonRow = deps.db.prepare('SELECT ppt_course_id, course_id FROM lessons WHERE id = ?').get(ctx.lessonId) as
        | { ppt_course_id: string | null; course_id: string }
        | undefined
      const pptCourseId = lessonRow?.ppt_course_id ?? lessonRow?.course_id
      if (pptCourseId != null) {
        try {
          const urls = await deps.school.listPpt(pptCourseId)
          const pptDir = join(attachmentsPath(deps.libraryRoot), ctx.lessonId, 'ppt')
          mkdirSync(pptDir, { recursive: true })
          const insertPpt = deps.db.prepare(
            'INSERT OR REPLACE INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES (?, ?, ?, ?, ?)'
          )
          for (const [i, url] of urls.entries()) {
            const file = join(pptDir, `page-${String(i).padStart(3, '0')}.png`)
            await downloadToFile(url, file, 3)
            insertPpt.run(`${ctx.lessonId}-ppt-${i}`, ctx.lessonId, i, file, nowIso(deps))
            pptCount++
          }
        } catch {
          // PPT is supplementary; keep keyframes as the visual evidence.
        }
      }

      recordStage(deps, ctx.taskId, ctx.stage, { keyframes: kept.length, ppt: pptCount })
      return { status: 'ok' }
    } catch (err) {
      return { status: 'failed', error: `关键帧/PPT 提取失败: ${(err as Error).message}` }
    }
  }
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

/** 6. summarizing — transcript + evidence → multimodal model → structured note JSON. */
export function makeSummarize(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    const binding = deps.db
      .prepare("SELECT provider_id, model FROM capability_bindings WHERE capability = 'multimodal'")
      .get() as { provider_id: string; model: string } | undefined
    if (binding == null) return { status: 'failed', error: '未绑定多模态模型，请在设置中配置' }
    const transcriptRow = deps.db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(ctx.lessonId) as
      | { segments_json: string }
      | undefined
    if (transcriptRow == null) return { status: 'failed', error: '转写结果缺失，无法生成笔记' }

    const keyframes = deps.db.prepare('SELECT id, timestamp_seconds FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds').all(ctx.lessonId) as Array<{ id: string; timestamp_seconds: number }>
    const ppt = deps.db.prepare('SELECT page_index FROM ppt_pages WHERE lesson_id = ? ORDER BY page_index').all(ctx.lessonId) as Array<{ page_index: number }>

    try {
      const client = deps.chat('multimodal')
      const answer = await client.chat(
        [
          {
            role: 'system',
            content:
              '你是课程笔记生成器。只输出一个 JSON 对象，不要多余文字。JSON 结构：{overview, knowledgeTree:{title,children:[{title,children}]},timeline:[{at,title,detail,refs:[{at,text}],evidence:[{kind,ref}]}],concepts:[{term,definition,refs}],formulasAndSteps:[{kind,content,explanation,refs}],methodology,examCues:[],questionsAndGaps:[],transcriptRefs:[{at,text}],evidence:[{kind,ref}]}。kind 只能是 ppt/keyframe/formula/code/operation。'
          },
          {
            role: 'user',
            content: `转写内容：\n${JSON.parse(transcriptRow.segments_json).map((s: { text: string }) => s.text).join('\n')}\n\n可用证据：keyframes=${keyframes.map((k) => k.id).join(',')}；ppt=${ppt.map((p) => p.page_index).join(',')}`
          }
        ],
        binding.model
      )

      let note: Note
      try {
        note = parseNote(answer)
      } catch {
        note = parseNote(stripFences(answer))
      }

      const versionRow = deps.db.prepare('SELECT MAX(version) AS v FROM notes WHERE lesson_id = ?').get(ctx.lessonId) as { v: number | null }
      const version = (versionRow.v ?? 0) + 1
      deps.db
        .prepare('INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(`${ctx.lessonId}-v${version}`, ctx.lessonId, version, JSON.stringify(note), 'openai-compatible', binding.model, nowIso(deps))

      recordStage(deps, ctx.taskId, ctx.stage, { version })
      return { status: 'ok' }
    } catch (err) {
      return { status: 'failed', error: `笔记生成失败: ${(err as Error).message}` }
    }
  }
}

export function createExecutors(deps: OrchestratorDeps): Record<Stage, StageExecutor> {
  return {
    fetching_course: makeFetchCourse(deps),
    downloading_video: makeDownload(deps),
    extracting_audio: makeExtractAudio(deps),
    transcribing: makeTranscribe(deps),
    extracting_visuals: makeExtractVisuals(deps),
    summarizing: makeSummarize(deps)
  }
}
