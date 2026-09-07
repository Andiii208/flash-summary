import type { JSX } from 'preact'
import { useEffect } from 'preact/hooks'
import { useModalScrollLock } from './use-modal-scroll-lock'

export interface DialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  /** Danger actions render the confirm in the destructive color. */
  danger?: boolean
  /** 批6: «view» dialogs (image zoom) — one close action instead of
   *  取消+关闭, backdrop click closes, background scroll is locked. */
  kind?: 'confirm' | 'view'
  /** 2026-09-04: optional custom body (e.g. an image viewer) between title and actions. */
  children?: preact.ComponentChildren
  onConfirm: () => void
  onCancel: () => void
}

/**
 * M3 批 D: in-app confirmation dialog replacing window.confirm (which
 * looked alien and blocked the renderer). Escape cancels; focus lands on
 * the cancel button so Enter-twice accidents are unlikely.
 * 批6: «view» kind — a pure viewer gets one close action and a backdrop
 * click; a «取消» next to «关闭» made the user hesitate over nothing.
 */
export function Dialog({ open, title, message, confirmLabel = '确认', danger = false, kind = 'confirm', children, onConfirm, onCancel }: DialogProps): JSX.Element | null {
  const view = kind === 'view'
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  // 批6: the page behind an open modal must not scroll (zooming an image
  // while the note slides behind reads as the page moving).
  useModalScrollLock(open)
  if (!open) return null
  return (
    <div
      class="dialog-backdrop"
      role="presentation"
      onClick={view ? (e) => { if (e.target === e.currentTarget) onCancel() } : undefined}
    >
      <div class="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3 class="dialog-title">{title}</h3>
        {message != null && message !== '' && <p class="dialog-message">{message}</p>}
        {children}
        <div class="dialog-actions">
          {view ? (
            <button class="btn primary" autoFocus onClick={onCancel}>
              {confirmLabel === '确认' ? '关闭' : confirmLabel}
            </button>
          ) : (
            <>
              <button class="btn" autoFocus onClick={onCancel}>
                取消
              </button>
              <button class={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
