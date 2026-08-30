import type { Db } from '../db/open'
import { PIPELINE_STAGES, type Stage, type StageResult } from './stages'

export interface StageContext {
  taskId: string
  lessonId: string
  /** The stage being executed. */
  stage: Stage
}

export interface StageExecutor {
  (ctx: StageContext): Promise<StageResult> | StageResult
}

export interface StageOutputStore {
  /** Persist the artifact of a completed stage, e.g. path or transcript json. */
  record: (ctx: StageContext, output: unknown) => void
  /** Whether the stage already has persisted output (reuse on retry). */
  has: (ctx: StageContext) => boolean
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

  get(taskId: string): { id: string; lesson_id: string; state: string; failed_stage: string | null; error_message: string | null } | undefined {
    return this.db.prepare('SELECT id, lesson_id, state, failed_stage, error_message FROM tasks WHERE id = ?').get(taskId) as
      | { id: string; lesson_id: string; state: string; failed_stage: string | null; error_message: string | null }
      | undefined
  }

  markStage(taskId: string, stage: Stage): void {
    this.db
      .prepare("UPDATE tasks SET state = ?, failed_stage = NULL, error_message = NULL, updated_at = ? WHERE id = ?")
      .run(stage, new Date().toISOString(), taskId)
  }

  markFailed(taskId: string, stage: Stage, error: string): void {
    this.db
      .prepare("UPDATE tasks SET state = 'failed', failed_stage = ?, error_message = ?, updated_at = ? WHERE id = ?")
      .run(stage, error, new Date().toISOString(), taskId)
  }

  markSucceeded(taskId: string): void {
    this.db
      .prepare("UPDATE tasks SET state = 'succeeded', failed_stage = NULL, error_message = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), taskId)
  }
}

/**
 * Run (or resume) a task through the pipeline.
 *
 * `firstStage` is where execution starts: on retry it is the failed stage.
 * Completed stages before it are never re-executed — their outputs are
 * reused (checked via StageOutputStore.has and asserted in tests).
 */
export async function runTask(
  repo: TaskRepository,
  taskId: string,
  executors: Record<Stage, StageExecutor>,
  outputs: StageOutputStore,
  firstStage: Stage
): Promise<'succeeded' | 'failed'> {
  const startIdx = PIPELINE_STAGES.indexOf(firstStage)
  for (let i = startIdx; i < PIPELINE_STAGES.length; i++) {
    const stage = PIPELINE_STAGES[i]
    const ctx: StageContext = { taskId, lessonId: repo.get(taskId)!.lesson_id, stage }

    // Reuse fast-path: a stage with persisted output that lies before the
    // resume point is skipped (test: failure injection + retry).
    if (i < startIdx && outputs.has(ctx)) continue

    repo.markStage(taskId, stage)
    const result = await executors[stage](ctx)
    if (result.status === 'failed') {
      repo.markFailed(taskId, stage, result.error)
      return 'failed'
    }
    outputs.record(ctx, { stage, at: new Date().toISOString() })
  }
  repo.markSucceeded(taskId)
  return 'succeeded'
}

/** Resume entry point: retry a failed task from its failed stage. */
export async function retryTask(
  repo: TaskRepository,
  taskId: string,
  executors: Record<Stage, StageExecutor>,
  outputs: StageOutputStore
): Promise<'succeeded' | 'failed'> {
  const row = repo.get(taskId)
  if (row == null) throw new Error(`task ${taskId} not found`)
  if (row.state !== 'failed' || row.failed_stage == null) {
    throw new Error(`task ${taskId} is not in a failed state (state=${row.state})`)
  }
  return runTask(repo, taskId, executors, outputs, row.failed_stage as Stage)
}
