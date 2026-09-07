import type { JSX } from 'preact'
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-preact'
import type { LucideIcon } from 'lucide-preact'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  /** D1: recurring identical toasts merge — how many times this message fired. */
  count?: number
  /** M1-3: optional inline action («查看笔记» / «去任务页»). */
  actionLabel?: string
  onAction?: () => void
}

export interface ToastAreaProps {
  toasts: ToastItem[]
  /** 批4: manual close — errors stay until the user dismisses them. */
  onDismiss?: (id: number) => void
}

/** One glyph per kind — color alone fails color-blind and glance reads. */
const KIND_ICONS: Record<ToastKind, LucideIcon> = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info
}

/** Fixed top-center feedback strip; each toast carries its kind class. */
export function ToastArea({ toasts, onDismiss }: ToastAreaProps): JSX.Element {
  return (
    <div class="toast-area" aria-live="polite">
      {toasts.map((t) => {
        const Icon = KIND_ICONS[t.kind]
        return (
          <div key={t.id} class={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : undefined}>
            {Icon != null && <Icon size={14} strokeWidth={1.75} class="toast-icon" />}
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
            {(t.count ?? 1) > 1 && (
              <span class="toast-count" title={`同样的提示出现了 ${t.count} 次`}>
                ×{t.count}
              </span>
            )}
            {onDismiss != null && (
              <button class="toast-close" aria-label="关闭这条通知" title="关闭" onClick={() => onDismiss(t.id)}>
                <X size={12} strokeWidth={1.75} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
