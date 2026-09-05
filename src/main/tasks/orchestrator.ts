/**
 * Stage executors wiring pipeline stages to real work (spec §3).
 * All I/O goes through injected deps so tests can stub the network,
 * ffmpeg, and providers while the orchestration logic stays real.
 */
import { mkdirSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Db } from '../db/open'
import { attachmentsPath } from '../library/paths'
import { extractAudio, extractKeyframes, run as runProcess, pickAudioSource } from '../media/ffmpeg'
import { chunkPlan, cutChunk } from '../media/audio-split'
import { dedupeKeyframes, type Grid8x8 } from '../media/phash'
import { downloadToFile } from '../media/download'
import { sanitizeStreamUrl } from '../school/play-harvest'
import { streamComplete, freeDiskBytes } from './resume'
import { storedAttachmentsPath } from '../library/paths'
import type { StageExecutor, StageContext } from './queue'
import type { Stage } from './stages'
import type { SchoolClient } from '../school/client'
import type { OpenAiCompatibleClient } from '../providers/openai-client'
import { summarizeLesson } from '../notes/summarize'

/** B6: refuse to start a multi-GB download below this free-space floor. */
export const MIN_FREE_DISK_BYTES = 5 * 1024 * 1024 * 1024

export interface OrchestratorDeps {
  db: Db
  libraryRoot: string
  /** Effective task-cache dir; re-read per task so a settings change takes effect immediately (U3). */
  cacheDir: () => string
  ffmpeg: string
  ffprobe: string
  school: SchoolClient
  /** Chat client factory for a capability (asr uses its HTTP endpoints). */
  chat: (capability: 'asr' | 'multimodal' | 'text') => OpenAiCompatibleClient
  /** Decodes a jpg into an 8x8 luminance grid for phash. */
  gridDecoder: (path: string) => Grid8x8
  /** Stream fetch: url → local file. Default remuxes via ffmpeg; tests stub it. */
  fetchStream?: (url: string, target: string, signal?: AbortSignal) => Promise<void>
  /**
   * V1 play-page harvest: lesson streams + catalog from the platform play
   * page (main-window navigation). Preferred path when the course row carries
   * teclId/teclCode; school.lessonDetail stays as the legacy fallback.
   */
  harvestLesson?: (input: {
    courseId: string
    teclId: string
    teclCode: string
    selectLessonRef: string | null
    signal?: AbortSignal
  }) => Promise<{
    teacherStreamUrl?: string
    screenStreamUrl?: string
    lessons?: Array<{ index: number; title: string; ref: string }>
  }>
  /** Per-chunk ASR progress (U4): index and total let the UI show chunk-level progress. */
  onChunkProgress?: (ctx: StageContext, index: number, total: number) => void
  /** M1-3: download byte/speed polling so the UI shows «已下载 x · y/s». */
  onDownloadProgress?: (ctx: StageContext, downloadedBytes: number, bytesPerSecond: number) => void
  /** B6 test hook: free-disk probe (tests never touch the real volume). */
  freeDiskOverride?: (path: string) => number | null
  now?: () => Date
}

function nowIso(deps: OrchestratorDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString()
}

/** True when the task was cancelled: the signal fired, or the error IS the abort. */
function isCancelled(ctx: StageContext, err?: unknown): boolean {
  if (ctx.signal?.aborted === true) return true
  return (err as Error | undefined)?.name === 'AbortError'
}

/** Uniform cancelled stage result so the DB/progress events say «已取消», not a masked failure. */
function cancelResult(): { status: 'failed'; error: string; kind: 'cancelled' } {
  return { status: 'failed', error: '任务已取消', kind: 'cancelled' }
}

function taskDir(deps: OrchestratorDeps, taskId: string): string {
  const dir = join(deps.cacheDir(), taskId)
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

/** Network errors and rate limits are transient — retry the upload. */
const TRANSCRIBE_RETRY_ATTEMPTS = 3

async function transcribeChunk(
  client: OpenAiCompatibleClient,
  audio: Blob,
  fileName: string,
  model: string,
  signal?: AbortSignal
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await client.transcribe(audio, fileName, model)).trim()
    } catch (err) {
      const kind = (err as { kind?: string }).kind
      if (attempt >= TRANSCRIBE_RETRY_ATTEMPTS || (kind !== 'network' && kind !== 'rate_limit')) throw err
      await new Promise((r) => setTimeout(r, 5000 * attempt))
      if (signal?.aborted) throw new Error('任务已取消')
    }
  }
}

/**
 * 1. fetching_course — resolve the lesson's stream URLs and upsert the lesson
 * row. Two paths:
 *  - play-page harvest (V1, preferred): the course row's teclId/teclCode feed
 *    the play-page route; the main window reads video.src for both streams.
 *    Full signed URLs flow to downloading_video via the stage output (never
 *    into the lessons table or logs — sanitized paths only there).
 *  - legacy JSON API fallback (school.lessonDetail) for rows without tecl
 *    fields (manual add) or test setups; the JSON interface is currently
 *    unreliable (GET missing params → 500) but may be fixed upstream.
 * Metadata is retained permanently per spec §7.
 */
export function makeFetchCourse(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    try {
      const lessonRow = deps.db.prepare('SELECT course_id, play_ref, title FROM lessons WHERE id = ?').get(ctx.lessonId) as
        | { course_id: string; play_ref: string | null; title: string }
        | undefined
      const courseRow =
        lessonRow != null
          ? (deps.db.prepare('SELECT id, tecl_id, tecl_code FROM courses WHERE id = ?').get(lessonRow.course_id) as
              | { id: string; tecl_id: string | null; tecl_code: string | null }
              | undefined)
          : undefined

      if (
        deps.harvestLesson != null &&
        courseRow != null &&
        courseRow.tecl_id != null &&
        courseRow.tecl_code != null
      ) {
        const harvest = await deps.harvestLesson({
          courseId: courseRow.id,
          teclId: courseRow.tecl_id,
          teclCode: courseRow.tecl_code,
          selectLessonRef: lessonRow?.play_ref ?? null,
          signal: ctx.signal
        })
        if (harvest.teacherStreamUrl == null || harvest.screenStreamUrl == null) {
          return { status: 'failed', error: '播放页收割未取得完整双流地址（教师流/屏幕流缺失）' }
        }
        // Durable lesson metadata: sanitized paths only (auth_key red line).
        deps.db
          .prepare('UPDATE lessons SET stream_urls_json = ?, fetched_at = ? WHERE id = ?')
          .run(
            JSON.stringify({
              teacher: sanitizeStreamUrl(harvest.teacherStreamUrl),
              screen: sanitizeStreamUrl(harvest.screenStreamUrl)
            }),
            nowIso(deps),
            ctx.lessonId
          )
        // Catalog refresh: converge the tree with the platform's own list.
        const upsertEntry = deps.db.prepare(
          `INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, play_ref = excluded.play_ref, fetched_at = excluded.fetched_at`
        )
        for (const entry of harvest.lessons ?? []) {
          upsertEntry.run(`${courseRow.id}-L${entry.index}`, courseRow.id, entry.title, entry.ref, nowIso(deps))
        }
        // Transient handoff: full signed URLs for the download stage only.
        recordStage(deps, ctx.taskId, ctx.stage, {
          lessonId: ctx.lessonId,
          teacherStreamUrl: harvest.teacherStreamUrl,
          screenStreamUrl: harvest.screenStreamUrl
        })
        return { status: 'ok' }
      }

      const detail = await deps.school.lessonDetail(ctx.lessonId, lessonRow?.course_id ?? '')

      // Red line (design review 2026-09-05): the lessons table stores
      // sanitized paths only — the full signed URLs ride the stage output
      // exactly like the V1 harvest path above, so the download stage's
      // fallback chain stays alive without breaking the red line.
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
          JSON.stringify({
            teacher: detail.teacherStreamUrl != null ? sanitizeStreamUrl(detail.teacherStreamUrl) : undefined,
            screen: detail.screenStreamUrl != null ? sanitizeStreamUrl(detail.screenStreamUrl) : undefined
          }),
          detail.pptCourseId ?? null,
          nowIso(deps)
        )
      recordStage(deps, ctx.taskId, ctx.stage, {
        lessonId: detail.id,
        teacherStreamUrl: detail.teacherStreamUrl,
        screenStreamUrl: detail.screenStreamUrl
      })
      return { status: 'ok' }
    } catch (err) {
      if (isCancelled(ctx, err)) return cancelResult()
      // Spec §2/§11.3: a session expiry mid-task is recognizable so the UI
      // can offer re-login instead of a generic failure.
      const kind = (err as { kind?: string }).kind
      return {
        status: 'failed',
        error: `获取课时信息失败: ${(err as Error).message}`,
        ...(kind === 'session_expired' ? { kind: 'session_expired' as const } : {})
      }
    }
  }
}

/** Default stream fetch: remux via ffmpeg (stream copy, no re-encode). */
async function fetchStreamDefault(ffmpeg: string, url: string, target: string, signal?: AbortSignal): Promise<void> {
  await runProcess(ffmpeg, ['-y', '-i', url, '-c', 'copy', target], {
    timeoutMs: 30 * 60 * 1000,
    stallGuard: { file: target, stallMs: 60_000 },
    signal
  })
}

/** B3: a killed/stalled remux leaves a partial file behind — retry per stream. */
const STREAM_DOWNLOAD_ATTEMPTS = 3

async function downloadStreamWithRetry(
  fetchStream: (url: string, target: string, signal?: AbortSignal) => Promise<void>,
  url: string,
  target: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fetchStream(url, target, signal)
      return
    } catch (err) {
      if (signal?.aborted || (err as Error)?.name === 'AbortError') throw err
      if (attempt >= STREAM_DOWNLOAD_ATTEMPTS) throw err
      if (signal?.aborted) throw new Error('任务已取消')
      await new Promise((r) => setTimeout(r, attempt === 1 ? 5000 : 15000))
    }
  }
}

/**
 * M1-3: poll the target files' sizes once a second while the streams
 * download and report byte totals + speed. The remux writes grow on disk,
 * which is the only reliable signal ffmpeg gives us.
 */
function startDownloadPoll(
  deps: OrchestratorDeps,
  ctx: StageContext,
  files: string[]
): { stop: () => void } {
  if (deps.onDownloadProgress == null) return { stop: () => undefined }
  let lastBytes = 0
  let lastAt = Date.now()
  const timer = setInterval(() => {
    let total = 0
    for (const file of files) {
      try {
        total += statSync(file).size
      } catch {
        // A stream file not created yet contributes 0.
      }
    }
    const now = Date.now()
    const seconds = Math.max(0.2, (now - lastAt) / 1000)
    const speed = Math.max(0, (total - lastBytes) / seconds)
    lastBytes = total
    lastAt = now
    if (total > 0) deps.onDownloadProgress?.(ctx, total, speed)
  }, 1000)
  return {
    stop: () => clearInterval(timer)
  }
}

/** 2. downloading_video — fetch teacher + screen streams into cache (panorama never). */
export function makeDownload(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    // V1: the fetching stage hands over full signed URLs (auth_key time-
    // limited). Fall back to the lessons table for the legacy JSON path and
    // pre-V1 rows (their URLs carry no signature anyway).
    const fetched = stageOutput<{ lessonId?: string; teacherStreamUrl?: string; screenStreamUrl?: string }>(
      deps,
      ctx.taskId,
      'fetching_course'
    )
    const row = deps.db.prepare('SELECT stream_urls_json FROM lessons WHERE id = ?').get(ctx.lessonId) as
      | { stream_urls_json: string | null }
      | undefined
    const stored = row?.stream_urls_json != null ? (JSON.parse(row.stream_urls_json) as { teacher?: string; screen?: string }) : {}
    const urls = {
      teacher: fetched?.teacherStreamUrl ?? stored.teacher,
      screen: fetched?.screenStreamUrl ?? stored.screen
    }
    if (urls.teacher == null || urls.screen == null) {
      return { status: 'failed', error: '课时缺少教师流或屏幕流地址，无法下载' }
    }
    // Panorama guard: refuse any URL tagged 1170194-3.
    if (urls.teacher.includes('1170194-3') || urls.screen.includes('1170194-3')) {
      return { status: 'failed', error: '检测到全景流地址（1170194-3），按规格禁止下载' }
    }
    // B6: fail fast (with a human message) instead of a cryptic ENOSPC two
    // hours in. Unknown (statfs unavailable) never blocks.
    const free = (deps.freeDiskOverride ?? freeDiskBytes)(deps.cacheDir())
    if (free != null && free < MIN_FREE_DISK_BYTES) {
      return { status: 'failed', error: `磁盘剩余空间不足 5GB（当前约 ${Math.floor(free / 1024 ** 3)}GB），请清理后重试` }
    }
    const dir = taskDir(deps, ctx.taskId)
    const teacherPath = join(dir, 'teacher.ts')
    const screenPath = join(dir, 'screen.ts')
    const poll = startDownloadPoll(deps, ctx, [teacherPath, screenPath])
    try {
      const fetchStream = deps.fetchStream ?? ((url: string, target: string, signal?: AbortSignal) => fetchStreamDefault(deps.ffmpeg, url, target, signal))
      // B3: each stream carries its own `.ok` completion marker, so a retry
      // re-downloads only the stream that actually failed instead of both
      // (a partial file from a killed run has no marker and is overwritten).
      for (const stream of [
        { label: '教师流', url: urls.teacher, path: teacherPath },
        { label: '屏幕流', url: urls.screen, path: screenPath }
      ]) {
        if (streamComplete(stream.path)) continue
        await downloadStreamWithRetry(fetchStream, stream.url, stream.path, ctx.signal)
        writeFileSync(`${stream.path}.ok`, '')
      }
      recordStage(deps, ctx.taskId, ctx.stage, { teacherPath, screenPath })
      return { status: 'ok' }
    } catch (err) {
      if (isCancelled(ctx, err)) return cancelResult()
      return { status: 'failed', error: `下载视频失败: ${(err as Error).message}` }
    } finally {
      poll.stop()
    }
  }
}

/** 3. extracting_audio — the stream that carries audio → 16k mono wav; teacher video deleted after success. */
export function makeExtractAudio(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    const dl = stageOutput<{ teacherPath: string; screenPath: string }>(deps, ctx.taskId, 'downloading_video')
    if (dl == null) return { status: 'failed', error: '下载阶段产物缺失，需要重新下载' }
    try {
      const dir = taskDir(deps, ctx.taskId)
      // Field reality (2026-09-02): the teacher stream may have no audio
      // track — the screen stream carries the classroom AAC. Probe both.
      const audioSource = await pickAudioSource(dl.teacherPath, dl.screenPath, deps.ffprobe)
      const { audioPath, durationSeconds } = await extractAudio(audioSource, dir, deps.ffmpeg, 'teacher-audio', ctx.signal)
      if (existsSync(dl.teacherPath)) rmSync(dl.teacherPath, { force: true })
      rmSync(`${dl.teacherPath}.ok`, { force: true })
      recordStage(deps, ctx.taskId, ctx.stage, { audioPath, durationSeconds })
      return { status: 'ok' }
    } catch (err) {
      if (isCancelled(ctx, err)) return cancelResult()
      return { status: 'failed', error: `音频提取失败: ${(err as Error).message}` }
    }
  }
}

/** B2 checkpoint shape stored in the transcribing stage row between chunks. */
interface TranscribeCheckpoint {
  totalChunks?: number
  chunks?: Array<{ index: number; at: number; text: string }>
}

/** 4. transcribing — audio → provider ASR, chunked to stay under the 25MB upload cap. */
export function makeTranscribe(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    const audio = stageOutput<{ audioPath: string; durationSeconds: number }>(deps, ctx.taskId, 'extracting_audio')
    if (audio == null) return { status: 'failed', error: '音频产物缺失，需要重新提取' }
    const binding = deps.db
      .prepare("SELECT provider_id, model FROM capability_bindings WHERE capability = 'asr'")
      .get() as { provider_id: string; model: string } | undefined
    if (binding == null) return { status: 'failed', error: '未绑定 ASR 模型，请在设置中配置 ASR Provider' }
    try {
      const client = deps.chat('asr')
      const plan = chunkPlan(audio.durationSeconds ?? 0)
      const outDir = taskDir(deps, ctx.taskId)
      // B2 checkpoint: chunks already transcribed survive a retry. A failure
      // at chunk 20/23 used to re-upload (and re-pay) all 20 — the row now
      // carries every completed chunk and the retry resumes from the first
      // missing one. chunkPlan is deterministic per audio duration, so the
      // indexes line up across runs.
      const prior = stageOutput<TranscribeCheckpoint>(deps, ctx.taskId, 'transcribing')
      const doneByIndex = new Map<number, { at: number; text: string }>()
      for (const chunk of prior?.chunks ?? []) doneByIndex.set(chunk.index, { at: chunk.at, text: chunk.text })
      const checkpoint = (): TranscribeCheckpoint => ({
        totalChunks: plan.length,
        chunks: [...doneByIndex.entries()].map(([index, segment]) => ({ index, at: segment.at, text: segment.text }))
      })
      for (const spec of plan) {
        if (ctx.signal?.aborted) return cancelResult()
        deps.onChunkProgress?.(ctx, spec.index, plan.length)
        if (doneByIndex.has(spec.index)) continue
        const chunkPath =
          plan.length === 1 ? audio.audioPath : await cutChunk(deps.ffmpeg, audio.audioPath, outDir, spec, ctx.signal)
        try {
          const blob = new Blob([readFileSync(chunkPath)])
          const text = await transcribeChunk(client, blob, `chunk-${spec.index}.wav`, binding.model, ctx.signal)
          // Silent gaps are normal at fixed boundaries — an empty chunk is
          // not an error; only a fully silent lesson is (handled below).
          if (text !== '') doneByIndex.set(spec.index, { at: spec.start, text })
        } finally {
          if (plan.length > 1 && existsSync(chunkPath)) rmSync(chunkPath, { force: true })
        }
        recordStage(deps, ctx.taskId, ctx.stage, checkpoint())
      }
      // Silent chunks are done-but-empty: they never join the segments.
      const segments: Array<{ at: number; text: string }> = []
      for (const spec of plan) {
        const segment = doneByIndex.get(spec.index)
        if (segment != null && segment.text !== '') segments.push({ at: segment.at, text: segment.text })
      }
      if (segments.length === 0) {
        return { status: 'failed', error: '该课时音频中没有可识别的语音（音量过低或静音），无法转写' }
      }
      deps.db
        .prepare(
          `INSERT OR REPLACE INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(ctx.lessonId, JSON.stringify(segments), 'openai-compatible', binding.model, nowIso(deps))
      // Audio is temporary: delete after successful transcription (spec §7).
      if (existsSync(audio.audioPath)) rmSync(audio.audioPath, { force: true })
      // Final overwrite: collapse the checkpoint to a small summary.
      recordStage(deps, ctx.taskId, ctx.stage, { chars: segments.reduce((n, s) => n + s.text.length, 0), chunks: plan.length })
      return { status: 'ok' }
    } catch (err) {
      if (isCancelled(ctx, err)) return cancelResult()
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
      const candidates = await extractKeyframes(dl.screenPath, outDir, 10, deps.ffmpeg, ctx.signal)
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
        insertKf.run(`${ctx.lessonId}-kf-${i}`, ctx.lessonId, frame.timestampSeconds, storedAttachmentsPath(ctx.lessonId, 'keyframes', `kf-${String(i).padStart(4, '0')}-${Math.round(frame.timestampSeconds)}s.jpg`), frame.hash, nowIso(deps))
      }
      if (existsSync(dl.screenPath)) rmSync(dl.screenPath, { force: true })
      rmSync(`${dl.screenPath}.ok`, { force: true })

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
            await downloadToFile(url, file, 3, ctx.signal)
            insertPpt.run(`${ctx.lessonId}-ppt-${i}`, ctx.lessonId, i, storedAttachmentsPath(ctx.lessonId, 'ppt', `page-${String(i).padStart(3, '0')}.png`), nowIso(deps))
            pptCount++
          }
        } catch {
          // PPT is supplementary; keep keyframes as the visual evidence.
        }
      }

      recordStage(deps, ctx.taskId, ctx.stage, { keyframes: kept.length, ppt: pptCount })
      return { status: 'ok' }
    } catch (err) {
      if (isCancelled(ctx, err)) return cancelResult()
      return { status: 'failed', error: `关键帧/PPT 提取失败: ${(err as Error).message}` }
    }
  }
}

/** Max images embedded in the multimodal summarize call (token guard, U4). */
export { MAX_SUMMARIZE_IMAGES } from '../notes/summarize'

/** 6. summarizing — transcript + real images (PPT/keyframes) → structured note JSON. */
export function makeSummarize(deps: OrchestratorDeps): StageExecutor {
  return async (ctx: StageContext) => {
    const binding = deps.db
      .prepare("SELECT provider_id, model FROM capability_bindings WHERE capability = 'multimodal'")
      .get() as { provider_id: string; model: string } | undefined
    if (binding == null) return { status: 'failed', error: '未绑定多模态模型，请在设置中配置' }

    try {
      const client = deps.chat('multimodal')
      // D6 (review): the summarize call honors cancellation — the abort
      // rides the provider request itself instead of waiting for a stage
      // boundary.
      const result = await summarizeLesson(deps.db, client, ctx.lessonId, deps.libraryRoot, ctx.signal)
      if ('error' in result) {
        // summarizeLesson catches internally — an abort surfaces as a
        // generic error result, so re-check the signal here.
        if (isCancelled(ctx)) return cancelResult()
        return { status: 'failed', error: result.error }
      }
      recordStage(deps, ctx.taskId, ctx.stage, result)
      return { status: 'ok' }
    } catch (err) {
      if (isCancelled(ctx, err)) return cancelResult()
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
