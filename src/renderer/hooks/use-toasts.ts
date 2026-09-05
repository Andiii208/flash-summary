/**
 * Toast state (review G1, 2026-09-05): first domain extracted from the
 * useAppState monolith. Self-contained by construction — every other
 * domain takes `toast` as a parameter.
 */
import { useCallback, useRef, useState } from 'preact/hooks'
import type { ToastItem, ToastKind } from '../components/ToastArea'

export interface Toasts {
  toasts: ToastItem[]
  toast: (message: string, kind?: ToastKind, action?: { actionLabel: string; onAction: () => void }) => void
}

export function useToasts(): Toasts {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(0)
  const toast = useCallback(
    (message: string, kind: ToastKind = 'info', action?: { actionLabel: string; onAction: () => void }): void => {
      const id = ++toastId.current
      setToasts((ts) => [...ts, { id, message, kind, ...(action ?? {}) }])
      const ms = action != null ? 8000 : kind === 'error' ? 6500 : 3500
      window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), ms)
    },
    []
  )
  return { toasts, toast }
}
