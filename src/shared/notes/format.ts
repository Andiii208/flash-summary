/**
 * Shared note display helpers (review F7, 2026-09-05): a single implementation
 * — views/markdown/evidence used to carry three drifting copies.
 */

/**
 * Format seconds as mm:ss.
 *
 * 批7 (T47): 先四舍五入到整秒再拆分——此前是 `Math.round(seconds % 60)`，于是
 * 119.6 会输出 `01:60`、59.6 会输出 `00:60`（可达路径：时间线戳、概念引用、
 * 缩放弹窗标题、PDF、Markdown/Obsidian 导出）。
 */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}


/** Chinese label for a formulasAndSteps kind. */
export function labelOf(kind: 'formula' | 'code' | 'operation'): string {
  return kind === 'formula' ? '公式' : kind === 'code' ? '代码' : '操作'
}
