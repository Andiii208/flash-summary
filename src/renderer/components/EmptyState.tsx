import type { JSX } from 'preact'

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
