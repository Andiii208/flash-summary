import type { JSX } from 'preact'
import { Dialog } from '../ui/Dialog'
import {
  FEEDBACK_COPY_LABEL,
  FEEDBACK_DIAGNOSTICS_HINT,
  FEEDBACK_DIAGNOSTICS_TITLE,
  FEEDBACK_SENSITIVE_HINT
} from '../../shared/feedback'

/**
 * 声明批6（plan 2026-09-11 compliance-disclosure）: the «反馈这个错误» dialog.
 *
 * 它**不发送任何东西**：聚一段已脱敏的诊断文本、给一个复制按钮，用户自己去反馈表
 * 粘贴。诊断文本用 `<pre>` 原样展示（用户复制到的必须和屏幕上看到的一致），
 * 底部固定一句隐私提醒——我们主动提供了「复制」，就有义务说清别复制什么。
 */
export function FeedbackDiagnosticsDialog({
  open,
  busy,
  text,
  onCopy,
  onClose
}: {
  open: boolean
  busy: boolean
  text: string
  onCopy: () => void
  onClose: () => void
}): JSX.Element | null {
  return (
    <Dialog
      open={open}
      kind="view"
      title={FEEDBACK_DIAGNOSTICS_TITLE}
      confirmLabel="关闭"
      onConfirm={onClose}
      onCancel={onClose}
    >
      <p class="feedback-hint">{FEEDBACK_DIAGNOSTICS_HINT}</p>
      <div class="feedback-body">
        <pre class="legal-raw" data-testid="feedback-diagnostics">
          {busy ? '正在整理诊断信息…' : text}
        </pre>
      </div>
      <p class="feedback-sensitive" data-testid="feedback-sensitive-hint">
        {FEEDBACK_SENSITIVE_HINT}
      </p>
      <button class="btn small" onClick={onCopy} disabled={busy || text === ''}>
        {FEEDBACK_COPY_LABEL}
      </button>
    </Dialog>
  )
}
