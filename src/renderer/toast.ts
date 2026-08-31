/**
 * Minimal toast feedback area (U1): fixed strip at the top of the window.
 * Messages auto-dismiss; errors stay a bit longer so they are readable.
 */
export type ToastKind = 'success' | 'error' | 'info'

const TOAST_MS: Record<ToastKind, number> = { success: 3000, info: 3500, error: 6500 }

export type ShowToast = (message: string, kind?: ToastKind) => void

export function createToastArea(root: HTMLElement): ShowToast {
  const area = document.createElement('div')
  area.className = 'toast-area'
  root.appendChild(area)
  return (message, kind = 'info') => {
    const toast = document.createElement('div')
    toast.className = `toast toast-${kind}`
    toast.textContent = message
    area.appendChild(toast)
    window.setTimeout(() => toast.remove(), TOAST_MS[kind])
  }
}
