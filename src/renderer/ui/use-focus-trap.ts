/**
 * 健康巡查 2026-09-12 批6: focus trap for modal surfaces.
 *
 * Before this, Tab walked straight out of an open dialog into the page
 * behind it (role="alertdialog" + aria-modal promised a modal surface the
 * keyboard could leave), and closing a dialog left focus wherever the last
 * Tab landed. While active: Tab/Shift+Tab cycle within the container and
 * focus returns to the previously focused element on close.
 */
import { useEffect } from 'preact/hooks'
import type { RefObject } from 'preact'

/** Everything inside the container that can take focus (disabled and
 *  tabindex=-1 excluded; visibility is guaranteed by the modal itself —
 *  collapsed content is unmounted, not hidden). */
function focusableIn(container: HTMLElement): HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  return Array.from(candidates).filter((el) => !el.hasAttribute('disabled'))
}

export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (container == null) return
      const focusable = focusableIn(container)
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const current = document.activeElement
      const inside = current instanceof HTMLElement && container.contains(current)
      if (e.shiftKey) {
        if (!inside || current === first) {
          e.preventDefault()
          last.focus()
        }
        return
      }
      if (!inside || current === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeydown)
    return () => {
      document.removeEventListener('keydown', onKeydown)
      // Hand focus back to where the dialog was opened from — keyboard users
      // must not be dropped at <body> after closing.
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [active, containerRef])
}
