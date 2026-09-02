import type { Db } from '../db/open'
import { PIPELINE_STAGES, stagePercent, type Stage, type StageResult, type TaskState } from './stages'

export interface StageContext {
  taskId: string
  lessonId: string
  /** The stage being executed. */
  stage: Stage
  /** Cancellation signal (U4): executors pass it to ffmpeg/download. */
  signal?: AbortSignal
}

export interface StageExecutor {
  (ctx: StageContext): Promise<StageResult> | StageResult
}

/**
 * Serialize task row updates. States are CHECK-constrained in SQL; this
 * repository adds the transition guard rails.
 */
export class TaskRepository {
  constructor(private readonly db: Db) {}

  create(taskId: string, lessonId: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)")
      .run(taskId, lessonId, now, now)
  }

  get(
    taskId: string
  ): { id: string; lesson_id: string; state: string; failed_stage: string | null; error_message: string | null; error_kind: string | null } | undefined {
    return this.db
      .prepare('SELECT id, lesson_id, state, failed_stage, error_message, error_kind FROM tasks WHERE id = ?')
      .get(taskId) as
      | { id: string; lesson_id: string; state: string; failed_stage: string | null; error_message: string | null; error_kind: string | null }
      | undefined
  }

  markStage(taskId: string, stage: Stage): void {
    this.db
      .prepare("UPDATE tasks SET state = ?, failed_stage = NULL, error_message = NULL, error_kind = NULL, updated_at = ? WHERE id = ?")
      .run(stage, new Date().toISOString(), taskId)
  }

  markFailed(taskId: string, stage: Stage, error: string, kind?: string): void {
    this.db
      .prepare("UPDATE tasks SET state = 'failed', failed_stage = ?, error_message = ?, error_kind = ?, updated_at = ? WHERE id = ?")
      .run(stage, error, kind ?? null, new Date().toISOString(), taskId)
  }

  markSucceeded(taskId: string): void {
    this.db
      .prepare("UPDATE tasks SET state = 'succeeded', failed_stage = NULL, error_message = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), taskId)
  }
}

/** Progress payload pushed to the renderer on every stage transition. */
export interface TaskProgress {
  taskId: string
  state: TaskState
  stage: Stage | null
  message: string
  percent: number
  /** Failure taxonomy: session expiry (UI offers re-login) or user cancellation. */
  kind?: 'session_expired' | 'cancelled'
}

export type ProgressListener = (p: TaskProgress) => void

/**
 * Run (or resume) a task through the pipeline.
 *
 * `firstStage` is where execution starts: on retry it is the failed stage.
 * Stage artifacts for resume come from the task_stage_outputs table, read
 * directly by the orchestrator's stage executors.
 *
 * `onProgress` (optional) is invoked after every stage transition and on
 * completion/failure so the renderer can show live state.
 *
 * `signal` (U4): when aborted, the task is marked failed(cancelled) at the
 * next stage boundary; the signal is also passed to executors so long
 * ffmpeg/download work can be killed promptly.
 */
export async function runTask(
  repo: TaskRepository,
  taskId: string,
  executors: Record<Stage, StageExecutor>,
  firstStage: Stage,
  onProgress?: ProgressListener,
  signal?: AbortSignal
): Promise<'succeeded' | 'failed'> {
  const startIdx = PIPELINE_STAGES.indexOf(firstStage)
  for (let i = startIdx; i < PIPELINE_STAGES.length; i++) {
    if (signal?.aborted) {
      return cancelTask(repo, taskId, PIPELINE_STAGES[i] as Stage, onProgress)
    }
    const stage = PIPELINE_STAGES[i]
    const ctx: StageContext = { taskId, lessonId: repo.get(taskId)!.lesson_id, stage, signal }

    repo.markStage(taskId, stage)
    onProgress?.({ taskId, state: stage, stage, message: `正在执行：${stage}`, percent: stagePercent(stage) })
    const result = await executors[stage](ctx)
    if (signal?.aborted) {
      return cancelTask(repo, taskId, stage, onProgress)
    }
    if (result.status === 'failed') {
      repo.markFailed(taskId, stage, result.error, result.kind)
      onProgress?.({
        taskId,
        state: 'failed',
        stage,
        message: result.error,
        percent: stagePercent(stage),
        ...(result.kind != null ? { kind: result.kind } : {})
      })
      return 'failed'
    }
  }
  repo.markSucceeded(taskId)
  onProgress?.({ taskId, state: 'succeeded', stage: null, message: '任务完成', percent: 100 })
  return 'succeeded'
}

/** Mark the task as failed with the cancellation reason (U4). */
function cancelTask(
  repo: TaskRepository,
  taskId: string,
  stage: Stage,
  onProgress?: ProgressListener
): 'failed' {
  repo.markFailed(taskId, stage, '任务已取消', 'cancelled')
  onProgress?.({ taskId, state: 'failed', stage, message: '任务已取消', percent: stagePercent(stage), kind: 'cancelled' })
  return 'failed'
}
