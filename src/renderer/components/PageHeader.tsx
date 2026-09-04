import type { JSX } from 'preact'

export interface PageHeaderProps {
  title: string
  /** Right-side context capsule (LessonChip) — omitted when there is none. */
  chip?: JSX.Element
}

/**
 * 批A: unified page head — the page title on the content axis with the
 * lesson identity capsule on the right. Replaces the bare per-panel h2 so
 * every page answers «which page, which lesson» in the same place.
 */
export function PageHeader({ title, chip }: PageHeaderProps): JSX.Element {
  return (
    <div class="page-head">
      <h2>{title}</h2>
      {chip}
    </div>
  )
}
