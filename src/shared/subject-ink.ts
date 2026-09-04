/** Six closed «subject ink» hues — all ≥4.5:1 on --surface as text (V2). */
export const SUBJECT_INKS = ['#2f6b46', '#8a6a2f', '#a4552f', '#3d5a80', '#6d4456', '#56683b'] as const

export type SubjectInk = (typeof SUBJECT_INKS)[number]

/** FNV-1a: stable across sessions, spreads course ids evenly over the palette. */
function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic ink for a course id — the same course always wears the same hue. */
export function subjectInk(id: string): SubjectInk {
  return SUBJECT_INKS[hashString(id) % SUBJECT_INKS.length]
}
