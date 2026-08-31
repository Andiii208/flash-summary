import type { JSX } from 'preact'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

export interface ToastAreaProps {
  toasts: ToastItem[]
}

/** Fixed top-center feedback strip; each toast carries its kind class. */
export function ToastArea({ toasts }: ToastAreaProps): JSX.Element {
  return (
    <div class="toast-area" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
