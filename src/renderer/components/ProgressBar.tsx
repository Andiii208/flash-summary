import type { JSX } from 'preact'

export interface ProgressBarProps {
  percent: number
  active: boolean
}

export function ProgressBar({ percent, active }: ProgressBarProps): JSX.Element {
  const width = `${Math.max(0, Math.min(100, percent))}%`
  return (
    <div class={`progress${active ? ' active' : ''}`} role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div class="progress-bar" style={{ width }} />
    </div>
  )
}
