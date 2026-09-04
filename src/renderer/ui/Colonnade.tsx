import type { JSX } from 'preact'

/**
 * 大礼堂 colonnade line mark — the app's own building, drawn flat (V2).
 * Pure geometry on a 24-grid; inherits currentColor so it stays ink on paper.
 */
export function Colonnade({ size = 24 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 8.5 12 3.5l8.5 5" />
      <path d="M4.5 8.5h15" />
      <path d="M6 11v6.5M9 11v6.5M12 11v6.5M15 11v6.5M18 11v6.5" />
      <path d="M5 17.5h14" />
      <path d="M3.5 20h17" />
    </svg>
  )
}
