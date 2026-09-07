import type { JSX } from 'preact'

export interface ProgressBarProps {
  percent: number
  active: boolean
}

export function ProgressBar({ percent, active }: ProgressBarProps): JSX.Element {
  const width = `${Math.max(0, Math.min(100, percent))}%`
  // 批2: 0% 时流光随宽度被裁剪成一条完全静止的空槽——起步阶段（排队/收割）
  // 恰恰最需要「在动」的信号，改用 indeterminate 往复动画。
  const indeterminate = active && percent <= 0
  return (
    <div
      class={`progress${active ? ' active' : ''}${indeterminate ? ' indeterminate' : ''}`}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div class="progress-bar" style={indeterminate ? undefined : { width }} />
    </div>
  )
}
