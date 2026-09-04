import type { JSX } from 'preact'
import { Colonnade } from '../ui/Colonnade'

export interface EmptyStateProps {
  title: string
  hint: string
  actionLabel?: string
  onAction?: () => void
}

/** Empty/guided state card (U2): first-run onboarding, empty lists. */
export function EmptyState({ title, hint, actionLabel, onAction }: EmptyStateProps): JSX.Element {
  return (
    <div class="empty-state">
      <div class="empty-mark" aria-hidden="true">
        <Colonnade size={30} />
      </div>
      <h3>{title}</h3>
      <p>{hint}</p>
      {actionLabel != null && onAction != null && (
        <button class="btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
