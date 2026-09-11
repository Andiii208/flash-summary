/**
 * 声明批6（plan 2026-09-11 compliance-disclosure）: the redactable diagnostics text
 * a user can copy out of a failed task.
 *
 * 纯函数，方便单测；**redaction 由调用方（ipc handler）用 main 的 `redact()` 兜底**
 * ——失败原因入库时已经脱敏过一次（queue.ts 的 markFailed），这里是第二道。之所以
 * 再兜一次：诊断文本会被用户**主动复制并粘贴到外部表单**，一旦漏了凭据就是真的
 * 泄露出去，而不是躺在日志里。
 */

export interface DiagnosticsTask {
  id: string
  state: string
  failed_stage: string | null
  error_message: string | null
  error_kind: string | null
  created_at?: string | null
  updated_at?: string | null
  lesson_title?: string | null
  course_name?: string | null
  /** 'seu' | 'bilibili' | null —— 哪个视频源失败。 */
  source?: string | null
}

export interface DiagnosticsInput {
  version: string
  /** 平台名，避免用户在反馈里说不清是校内课还是 B 站。 */
  platform: string
  logsDir: string
  task: DiagnosticsTask | null
}

const SOURCE_LABELS: Record<string, string> = {
  seu: '东南大学云课堂',
  bilibili: 'B站'
}

function line(label: string, value: string | null | undefined): string[] {
  return value == null || value === '' ? [] : [`${label}：${value}`]
}

/** Build the copyable report. Missing fields are omitted, never rendered as «null». */
export function buildDiagnostics(input: DiagnosticsInput): string {
  const { task } = input
  const lines: string[] = [
    '—— Flash Summary 诊断信息（请连同上面的问题描述一起提交）——',
    `应用版本：${input.version}`,
    `操作系统：${input.platform}`,
    `报告时间：${new Date().toISOString()}`
  ]
  if (task == null) {
    lines.push('任务信息：未找到该任务（可能已被删除）')
  } else {
    lines.push(
      ...line('任务 ID', task.id),
      ...line('视频源', task.source != null ? (SOURCE_LABELS[task.source] ?? task.source) : null),
      ...line('课程', task.course_name),
      ...line('课时', task.lesson_title),
      ...line('任务状态', task.state),
      ...line('失败阶段', task.failed_stage),
      ...line('失败原因', task.error_message),
      ...line('取消类型', task.error_kind),
      ...line('创建时间', task.created_at),
      ...line('最后更新', task.updated_at)
    )
  }
  lines.push(`日志目录：${input.logsDir}`)
  return lines.join('\n')
}
