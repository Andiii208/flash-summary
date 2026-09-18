/** Human-readable byte sizes for download progress (M1-3). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

/**
 * 批7 (T48): 时间戳全应用只有这一个实现——此前 NoteLibrary 与 QaPanel 各写一份
 * （连非法输入的回退值都已分叉：一个给「—」、一个给原串），SettingsPanel 又用
 * 无 locale 无选项的 `toLocaleString()`（输出随系统区域变化）。
 */
export function formatStamp(when: string | number): string {
  const d = new Date(when)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * 批7 (T48): 一周内用相对时间（「刚刚 / N 分钟前 / …」），更早给完整时间戳。
 * 三条时间线（任务历史、笔记库、追问记录）从此同一口径。
 */
export function formatRelativeStamp(when: string | number, now: Date = new Date()): string {
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = now.getTime() - d.getTime()
  if (diffMs < 60_000) return '刚刚'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`
  if (diffMs < 7 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)} 天前`
  return formatStamp(when)
}

/**
 * 批7 (T49): 时长用中文单位，时间戳用 mm:ss —— 两条口径各司其职。此前 B站导入
 * 对话框自己算「约 N 分钟」，与全局的 mm:ss 是两套写法。
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} 秒`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
}

/** Human-readable transfer speed (bytes per second). */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''
  const mbps = bytesPerSecond / 1024 / 1024
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`
}
