import type { JSX } from 'preact'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  /** M1-3: optional inline action («查看笔记» / «去任务页»). */
  actionLabel?: string
  onAction?: () => void
}

export interface ToastAreaProps {
  toasts: ToastItem[]
}

/** Fixed top-center feedback strip; each toast carries its kind class. */
export function ToastArea({ toasts }: ToastAreaProps): JSX.Element {
  return (
    <div class="toast-area" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : undefined}>
          <span>{t.message}</span>
          {t.actionLabel != null && t.onAction != null && (
            <button
              class="toast-action"
              onClick={() => {
                t.onAction?.()
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
