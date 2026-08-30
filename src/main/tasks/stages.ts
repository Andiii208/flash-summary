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

/** Stages strictly after the given one. */
export function stagesAfter(stage: Stage): Stage[] {
  const i = PIPELINE_STAGES.indexOf(stage)
  return PIPELINE_STAGES.slice(i + 1)
}

/** Stages at or before the given one (inclusive) — the ones a retry reuses. */
export function stagesUpTo(stage: Stage): Stage[] {
  const i = PIPELINE_STAGES.indexOf(stage)
  return PIPELINE_STAGES.slice(0, i + 1)
}

export interface StageOutcome {
  /** Mark the stage done (persist its outputs) and move to the next. */
  ok: true
  /** Fail the task at this stage with a message. */
  failed: false
}

export type StageResult =
  | { status: 'ok' }
  | { status: 'failed'; error: string }

export interface TaskRow {
  id: string
  lesson_id: string
  state: TaskState
  failed_stage: Stage | null
  error_message: string | null
}

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
