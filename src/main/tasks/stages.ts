/**
 * Task state machine per spec §7:
 * pending → fetching_course → downloading_video → extracting_audio →
 * transcribing → extracting_visuals → summarizing → succeeded
 * Any stage may fail into failed(stage); retry resumes from that stage,
 * reusing all previously completed stage outputs.
 */
export const PIPELINE_STAGES = [
  'fetching_course',
  'downloading_video',
  'extracting_audio',
  'transcribing',
  'extracting_visuals',
  'summarizing'
] as const

export type Stage = (typeof PIPELINE_STAGES)[number]
export type TaskState = 'pending' | Stage | 'succeeded' | 'failed'

/**
 * Rough completion percentage of a stage for progress display:
 * stage k of N reports round((k+1)/N * 100) — the stage is *done* when its
 * event fires (we emit on completion, see runTask's onProgress).
 */
export function stagePercent(stage: Stage): number {
  const i = PIPELINE_STAGES.indexOf(stage)
  if (i < 0) return 0
  return Math.min(100, Math.round(((i + 1) / PIPELINE_STAGES.length) * 100))
}

export type StageResult =
  | { status: 'ok' }
  | { status: 'failed'; error: string; kind?: 'session_expired' | 'cancelled' }

/** Validate state transitions for the task queue runner. */
export function canTransition(from: TaskState, to: TaskState): boolean {
  if (from === 'failed') return PIPELINE_STAGES.includes(to as Stage) || to === 'pending'
  if (from === 'pending') return PIPELINE_STAGES.includes(to as Stage)
  if (from === 'succeeded') return false
  const i = PIPELINE_STAGES.indexOf(from as Stage)
  if (to === 'failed') return true
  if (to === 'succeeded') return i === PIPELINE_STAGES.length - 1
  const j = PIPELINE_STAGES.indexOf(to as Stage)
  return j === i + 1
}
