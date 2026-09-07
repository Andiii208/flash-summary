/**
 * Toast state (review G1, 2026-09-05): first domain extracted from the
 * useAppState monolith. Self-contained by construction — every other
 * domain takes `toast` as a parameter.
 *
 * 批4 错误反馈（plan 2026-09-07）：error 常驻直至手动关闭（错误必须读完，
 * 6.5s 自动消失曾让长报错读不完即丢）；全部类型可手动关闭；同屏上限 3 条，
 * 超出时最旧的先让位（FIFO）——防止批量失败堆叠遮挡 TopBar。
 */
import { useCallback, useRef, useState } from 'preact/hooks'
import type { ToastItem, ToastKind } from '../components/ToastArea'

export interface Toasts {
  toasts: ToastItem[]
  toast: (message: string, kind?: ToastKind, action?: { actionLabel: string; onAction: () => void }) => void
  dismiss: (id: number) => void
}

/** Max toasts on screen at once — beyond this, the oldest yields. */
const MAX_VISIBLE = 3

export function useToasts(): Toasts {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(0)
  const dismiss = useCallback((id: number): void => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])
  const toast = useCallback(
    (message: string, kind: ToastKind = 'info', action?: { actionLabel: string; onAction: () => void }): void => {
      const id = ++toastId.current
      setToasts((ts) => {
        const next = [...ts, { id, message, kind, ...(action ?? {}) }]
        return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
      })
      // Errors stay until manually closed; actionable toasts get 8s, plain ones 3.5s.
      if (kind !== 'error') {
        const ms = action != null ? 8000 : 3500
        window.setTimeout(() => dismiss(id), ms)
      }
    },
    [dismiss]
  )
  return { toasts, toast, dismiss }
}
