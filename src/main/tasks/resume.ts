/**
 * Resume-point resolution (design review 2026-09-05 B1, P0-1 fix).
 *
 * Retrying a failed task used to trust the task_stage_outputs handoff
 * unconditionally: an expired auth_key URL, an audio file reaped by the
 * 24h cache cleanup, or a cache-dir move all produced a permanent failure
 * loop — the executor re-ran the failed stage against inputs that could
 * never work again. resolveResumeStage checks each stage's actual inputs
 * and degrades the resume point to the earliest stage that can rebuild
 * them. Pure over the db + filesystem so it is directly testable.
 */
import { existsSync } from 'fs'
import type { Db } from '../db/open'
import { PIPELINE_STAGES, type Stage } from './stages'

/**
 * auth_key URLs are time-limited signatures (V4.1 field test: still valid
 * after 8h). 6h is the conservative freshness window; beyond it a resume
 * re-harvests from the play page instead of downloading against a dead
 * signature. Legacy (pre-V1) URLs carry no signature and never expire.
 * Bilibili stream URLs are documented to live 120 minutes — a 100-minute
 * window leaves margin for a long queue.
 */
export const STREAM_URL_FRESH_MS = 6 * 60 * 60 * 1000
export const BILI_STREAM_FRESH_MS = 100 * 60 * 1000

export interface ResumeDecision {
  stage: Stage
  /** Human-readable reason when a degradation happened ('' = direct resume). */
  note: string
}

interface FetchHandoff {
  teacherStreamUrl?: string
  screenStreamUrl?: string
  harvestedAt?: string
  /** Bilibili handoff (plan 2026-09-06 M4) — per-source shape below. */
  bilibili?: boolean
  videoStreamUrl?: string | null
  audioStreamUrl?: string | null
  hasSubtitle?: boolean
}

interface DownloadHandoff {
  teacherPath?: string
  screenPath?: string
  bilibili?: boolean
  videoPath?: string
  audioPath?: string
}

interface AudioHandoff {
  audioPath?: string
  skipped?: string
}

function readOutput<T>(db: Db, taskId: string, stage: Stage): T | null {
  const row = db.prepare('SELECT output_json FROM task_stage_outputs WHERE task_id = ? AND stage = ?').get(taskId, stage) as
    | { output_json: string }
    | undefined
  if (row == null) return null
  try {
    return JSON.parse(row.output_json) as T
  } catch {
    // A corrupted row is a missing product (review B1: no more dead ends
    // from one broken JSON line).
    return null
  }
}

/** True when the signed URL handoff is fresh enough to download against. */
export function urlsAreFresh(handoff: FetchHandoff | null, now: number): boolean {
  if (handoff == null) return false
  if (handoff.bilibili === true) {
    // At least one usable input: any stream, or a subtitle-only run.
    const hasStream =
      (handoff.videoStreamUrl != null && handoff.videoStreamUrl !== '') ||
      (handoff.audioStreamUrl != null && handoff.audioStreamUrl !== '') ||
      handoff.hasSubtitle === true
    if (!hasStream) return false
    if (handoff.harvestedAt == null) return false
    const harvested = Date.parse(handoff.harvestedAt)
    return Number.isFinite(harvested) && now - harvested <= BILI_STREAM_FRESH_MS
  }
  if (handoff.teacherStreamUrl == null || handoff.screenStreamUrl == null) return false
  const signed = handoff.teacherStreamUrl.includes('auth_key=') || handoff.screenStreamUrl.includes('auth_key=')
  if (!signed) return true
  if (handoff.harvestedAt == null) return false
  const harvested = Date.parse(handoff.harvestedAt)
  return Number.isFinite(harvested) && now - harvested <= STREAM_URL_FRESH_MS
}

/** A stream file counts as present only with its completion marker (批B3). */
export function streamComplete(path: string | undefined): boolean {
  if (path == null || path === '') return false
  return existsSync(path) && existsSync(`${path}.ok`)
}

function stageIndex(stage: Stage): number {
  return PIPELINE_STAGES.indexOf(stage)
}

/** The earliest stage in [from..failedStage] whose requirement is unmet. */
function degrade(db: Db, taskId: string, failedStage: Stage, now: number): ResumeDecision {
  // Walk from the failed stage downward; the first stage whose INPUTS are
  // ready is the resume point. Inputs are produced by the stage below, so
  // an unmet requirement degrades resume TO that producer (it re-runs and
  // every later stage re-runs after it, overwriting its output row).
  for (let i = stageIndex(failedStage); i >= 0; i--) {
    const stage = PIPELINE_STAGES[i] as Stage
    const ok =
      stage === 'summarizing'
        ? true // reads transcripts/keyframes/ppt tables directly — no file inputs
        : stage === 'extracting_visuals'
          ? (() => {
              const dl = readOutput<DownloadHandoff>(db, taskId, 'downloading_video')
              if (dl == null) return false
              if (dl.bilibili === true) {
                // No video stream → the stage itself skips (legal no-evidence note).
                return dl.videoPath == null || streamComplete(dl.videoPath)
              }
              return streamComplete(dl.screenPath)
            })()
          : stage === 'transcribing'
            ? (() => {
                const audio = readOutput<AudioHandoff>(db, taskId, 'extracting_audio')
                if (audio?.audioPath != null) return existsSync(audio.audioPath)
                // Bilibili subtitle fast path: the skip marker IS the product.
                return audio?.skipped === 'bilibili-subtitle'
              })()
            : stage === 'extracting_audio'
              ? (() => {
                  const dl = readOutput<DownloadHandoff>(db, taskId, 'downloading_video')
                  if (dl == null) return false
                  if (dl.bilibili === true) {
                    // Subtitle path needs no audio; audio path needs the m4a.
                    return dl.audioPath == null || streamComplete(dl.audioPath)
                  }
                  return streamComplete(dl.teacherPath) || streamComplete(dl.screenPath)
                })()
              : /* downloading_video */ urlsAreFresh(readOutput<FetchHandoff>(db, taskId, 'fetching_course'), now)

    if (ok) {
      return i === stageIndex(failedStage)
        ? { stage, note: '' }
        : {
            stage,
            note: `失败阶段（${failedStage}）的产物已缺失或过期，自动从「${stage}」重新开始`
          }
    }
  }
  // Nothing upstream is usable — start from the top (re-harvest).
  return { stage: 'fetching_course', note: `失败阶段（${failedStage}）的产物已缺失或过期，自动从头重新开始` }
}

/** First stage for a retry: the failed stage, degraded when its inputs died. */
export function resolveResumeStage(db: Db, taskId: string, failedStage: Stage, now = Date.now()): ResumeDecision {
  if (!PIPELINE_STAGES.includes(failedStage)) return { stage: 'fetching_course', note: '' }
  return degrade(db, taskId, failedStage, now)
}

/** B6: bytes available on the volume holding path (null when unreadable —
 *  callers must not block a download on an unknown value). */
export function freeDiskBytes(path: string): number | null {
  try {
    // Node ≥18.15 statfsSync; Node 24 in production supports win32.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { statfsSync } = require('fs') as { statfsSync: (p: string) => { bavail: number; bsize: number } }
    const stats = statfsSync(path)
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}
