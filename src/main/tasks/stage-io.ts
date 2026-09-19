/**
 * 批5 (plan 2026-09-19 audit remediation): task_stage_outputs 的唯一读取入口。
 *
 * resume.ts 的 readOutput 与 orchestrator.ts 的 stageOutput 此前各写了一份
 * JSON.parse——orchestrator 那份没有兜底：一行坏 JSON（磁盘故障、外部改库）
 * 会把阶段执行器整个炸穿，用户看到一句「执行异常: Unexpected token」。坏行
 * 一律回落 null 当作产物缺失，与 resume 的降级逻辑同口径。
 */
import type { Db } from '../db/open'
import type { Stage } from './stages'

export function readStageOutput<T>(db: Db, taskId: string, stage: Stage): T | null {
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
