import type { ComponentChildren, JSX } from 'preact'
import { Colonnade } from '../ui/Colonnade'

export interface EmptyStateAction {
  label: string
  onAction: () => void
  /** 'primary' marks the recommended first step (WelcomeGuide). */
  kind?: 'default' | 'primary'
  disabled?: boolean
}

export interface EmptyStateProps {
  title: string
  /** 批6: optional — a title-only card (e.g. «尚无笔记») no longer needs a hint. */
  hint?: string
  /** Legacy single action (most call sites). */
  actionLabel?: string
  onAction?: () => void
  /** 批6: multi-action cards — WelcomeGuide converged onto EmptyState. */
  actions?: EmptyStateAction[]
  /** Extra class on the card (WelcomeGuide keeps its spacing class). */
  className?: string
  /** Content between the hint and the actions (e.g. the guide steps). */
  children?: ComponentChildren
}

/** Empty/guided state card (U2): first-run onboarding, empty lists. */
export function EmptyState({ title, hint, actionLabel, onAction, actions, className, children }: EmptyStateProps): JSX.Element {
  return (
    <div class={className != null ? `empty-state ${className}` : 'empty-state'}>
      <div class="empty-mark" aria-hidden="true">
        <Colonnade size={30} />
      </div>
      <h3>{title}</h3>
      {hint != null && hint !== '' && <p>{hint}</p>}
      {children}
      {actions != null && actions.length > 0 ? (
        <div class="empty-actions">
          {actions.map((action) => (
            <button key={action.label} class={`btn${action.kind === 'primary' ? ' primary' : ''}`} onClick={action.onAction} disabled={action.disabled === true}>
              {action.label}
            </button>
          ))}
        </div>
      ) : (
        actionLabel != null &&
        onAction != null && (
          <button class="btn" onClick={onAction}>
            {actionLabel}
          </button>
        )
      )}
    </div>
  )
}
