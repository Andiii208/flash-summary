/**
 * Pipeline wiring for stage executors used by the task queue (Phase 3).
 * Each function maps a pipeline stage to ffmpeg/media work and persists
 * artifacts + evidence rows into the library database.
 */
import { mkdirSync, existsSync, rmSync, renameSync } from 'fs'
import { join } from 'path'
import type { Db } from '../db/open'
import { attachmentsPath, cachePath } from '../library/paths'
import { extractAudio, extractKeyframes, probeMedia } from './ffmpeg'
import { dedupeKeyframes, type Grid8x8 } from './phash'
import { TEACHER_STREAM_ID, SCREEN_STREAM_ID } from './streams'
import { downloadToFile } from './download'

export interface MediaPipelineDeps {
  db: Db
  libraryRoot: string
  ffmpeg: string
  ffprobe: string
}

export interface LessonStreams {
  teacherStreamUrl?: string
  screenStreamUrl?: string
}

/**
 * Download a stream to the cache area. Panorama (1170194-3) URLs are
 * rejected outright — the pipeline never downloads them (spec §3).
 */
export async function downloadStreamForTask(
  deps: MediaPipelineDeps,
  taskId: string,
  kind: 'teacher' | 'screen',
  url: string
): Promise<string> {
  if (url.includes('1170194-3')) {
    throw new Error('panorama stream (1170194-3) must never be downloaded')
  }
  const dir = join(cachePath(deps.libraryRoot), taskId)
  mkdirSync(dir, { recursive: true })
  const ext = kind === 'teacher' ? 'ts' : 'ts'
  const target = join(dir, `${kind}-stream.${ext}`)
  await downloadToFile(url, target)
  return target
}

export async function runAudioExtraction(
  deps: MediaPipelineDeps,
  taskId: string,
  _lessonId: string,
  teacherVideoPath: string
): Promise<string> {
  const outDir = join(cachePath(deps.libraryRoot), taskId)
  mkdirSync(outDir, { recursive: true })
  const { audioPath, durationSeconds } = await extractAudio(teacherVideoPath, outDir, deps.ffmpeg)

  // Evidence row: transcript table holds segments; audio metadata goes to task record.
  deps.db
    .prepare("UPDATE tasks SET error_message = NULL WHERE id = ?")
    .run(taskId)
  recordStageOutput(deps.db, taskId, 'extracting_audio', JSON.stringify({ audioPath, durationSeconds }))
  return audioPath
}

export async function runKeyframeExtraction(
  deps: MediaPipelineDeps,
  taskId: string,
  lessonId: string,
  screenVideoPath: string,
  /** Required: a real decoder (media/grid decodeGrid8x8). A flat placeholder
   *  would make every keyframe hash identical and silently drop evidence. */
  gridDecoder: (path: string) => Grid8x8
): Promise<number> {
  const outDir = join(cachePath(deps.libraryRoot), taskId, 'keyframes')
  mkdirSync(outDir, { recursive: true })

  const candidates = await extractKeyframes(screenVideoPath, outDir, 10, deps.ffmpeg)
  const kept = dedupeKeyframes(
    candidates.map((c) => ({ ...c, grid: gridDecoder(c.filePath) })),
    5
  )

  const attachments = attachmentsPath(deps.libraryRoot)
  const destDir = join(attachments, lessonId, 'keyframes')
  mkdirSync(destDir, { recursive: true })

  const now = new Date().toISOString()
  const insert = deps.db.prepare(
    'INSERT OR REPLACE INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  for (const [i, frame] of kept.entries()) {
    const name = `kf-${String(i).padStart(4, '0')}-${Math.round(frame.timestampSeconds)}s.jpg`
    const dest = join(destDir, name)
    // Move candidate into attachments (retained per spec §7).
    moveFile(frame.filePath, dest)
    insert.run(`${lessonId}-kf-${i}`, lessonId, frame.timestampSeconds, dest, frame.hash, now)
  }

  // Screen stream video is temporary: delete after successful extraction (spec §7).
  if (existsSync(screenVideoPath)) rmSync(screenVideoPath, { force: true })

  recordStageOutput(deps.db, taskId, 'extracting_visuals', JSON.stringify({ kept: kept.length, candidates: candidates.length }))
  return kept.length
}

export async function probeStreamVideo(deps: MediaPipelineDeps, videoPath: string): Promise<{ durationSeconds: number; width: number; height: number }> {
  return probeMedia(videoPath, deps.ffprobe)
}

function recordStageOutput(db: Db, taskId: string, stage: string, outputJson: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, ?, ?)'
  ).run(taskId, stage, outputJson)
}

function moveFile(from: string, to: string): void {
  renameSync(from, to)
}

export const STREAM_IDS = { TEACHER_STREAM_ID, SCREEN_STREAM_ID }
