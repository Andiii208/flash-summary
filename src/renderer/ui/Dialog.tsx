import type { JSX } from 'preact'
import { useEffect } from 'preact/hooks'

export interface DialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  /** Danger actions render the confirm in the destructive color. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * M3 批 D: in-app confirmation dialog replacing window.confirm (which
 * looked alien and blocked the renderer). Escape cancels; focus lands on
 * the cancel button so Enter-twice accidents are unlikely.
 */
export function Dialog({ open, title, message, confirmLabel = '确认', danger = false, onConfirm, onCancel }: DialogProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div class="dialog-backdrop" role="presentation">
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3 class="dialog-title">{title}</h3>
        <p class="dialog-message">{message}</p>
        <div class="dialog-actions">
          <button class="btn" autoFocus onClick={onCancel}>
            取消
          </button>
          <button class={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
