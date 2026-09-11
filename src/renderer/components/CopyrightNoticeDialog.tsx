import type { JSX } from 'preact'
import { Dialog } from '../ui/Dialog'
import {
  COPYRIGHT_NOTICE_CHECK_LABEL,
  COPYRIGHT_NOTICE_CONFIRM_LABEL,
  COPYRIGHT_NOTICE_MESSAGE,
  COPYRIGHT_NOTICE_TITLE
} from '../../shared/copyright-notice'

/**
 * 声明批4（plan 2026-09-11 compliance-disclosure, D3=B）: the export-time
 * copyright reminder — the promise spec §9 and the README had made but never
 * implemented.
 *
 * 它**不是**确认弹窗：确认按钮的语义是「继续导出」，取消就是这次不导。勾选
 * 「不再提示」只影响以后是否再提示，不影响本次导出。用共享 `Dialog`（UI 约定：
 * 模态层只有一种实现），焦点仍落在取消键上（防连按回车误确认）。
 */
export function CopyrightNoticeDialog({
  open,
  remember,
  onRememberChange,
  onConfirm,
  onCancel
}: {
  open: boolean
  remember: boolean
  onRememberChange: (value: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element | null {
  return (
    <Dialog
      open={open}
      title={COPYRIGHT_NOTICE_TITLE}
      message={COPYRIGHT_NOTICE_MESSAGE}
      confirmLabel={COPYRIGHT_NOTICE_CONFIRM_LABEL}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <label class="dialog-check">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => onRememberChange((event.target as HTMLInputElement).checked)}
        />
        {COPYRIGHT_NOTICE_CHECK_LABEL}
      </label>
    </Dialog>
  )
}
