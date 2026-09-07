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

/**
 * D1 (plan 2026-09-07 v07): same kind+message recurring merges into the
 * existing toast — count ticks up instead of stacking identical persistent
 * errors (the Fake-IP precheck fired from several entries and piled up 3).
 * The merged toast moves to the end so recency, not arrival order, decides
 * what the FIFO cap evicts.
 */
export function mergeToast(list: ToastItem[], entry: ToastItem): ToastItem[] {
  const existing = list.find((t) => t.message === entry.message && t.kind === entry.kind)
  if (existing == null) {
    const next = [...list, entry]
    return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
  }
  const merged: ToastItem = { ...existing, ...(entry.actionLabel != null ? { actionLabel: entry.actionLabel, onAction: entry.onAction } : {}), count: (existing.count ?? 1) + 1 }
  return [...list.filter((t) => t.id !== existing.id), merged]
}

export function useToasts(): Toasts {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(0)
  const dismiss = useCallback((id: number): void => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
  }, [])
  const toast = useCallback(
    (message: string, kind: ToastKind = 'info', action?: { actionLabel: string; onAction: () => void }): void => {
      const id = ++toastId.current
      setToasts((ts) => mergeToast(ts, { id, message, kind, ...(action ?? {}) }))
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
