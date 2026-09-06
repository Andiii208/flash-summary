import type { Db } from '../db/open'

export interface ChainTask {
  taskId: string
  lessonId: string
}

/**
 * The next pending task to auto-start after a bilibili task succeeds
 * (plan 2026-09-06 usability pass, 2026-09-07).
 *
 * The import creates one pending task row per selected P; those rows ARE
 * the chain state — no extra bookkeeping, visible in the task panel,
 * cancellable/deletable like any task. Only bilibili courses chain: SEU
 * courses keep their explicit per-lesson start. Chains only advance on
 * success — a failed P stops the course until the user retries.
 */
export function nextPendingChainTask(db: Db, finishedLessonId: string): ChainTask | null {
  const current = db
    .prepare("SELECT course_id FROM lessons WHERE id = ? AND source = 'bilibili'")
    .get(finishedLessonId) as { course_id: string } | undefined
  if (current == null) return null
  const next = db
    .prepare(
      `SELECT t.id AS taskId, t.lesson_id AS lessonId
       FROM tasks t JOIN lessons l ON l.id = t.lesson_id
       WHERE l.course_id = ? AND l.source = 'bilibili' AND t.state = 'pending'
       ORDER BY l.bili_page, t.created_at
       LIMIT 1`
    )
    .get(current.course_id) as ChainTask | undefined
  return next ?? null
}
