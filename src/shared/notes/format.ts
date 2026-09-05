/**
 * Shared note display helpers (review F7, 2026-09-05): a single implementation
 * — views/markdown/evidence used to carry three drifting copies.
 */

/** Format seconds as mm:ss. */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Chinese label for a formulasAndSteps kind. */
export function labelOf(kind: 'formula' | 'code' | 'operation'): string {
  return kind === 'formula' ? '公式' : kind === 'code' ? '代码' : '操作'
}
