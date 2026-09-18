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

/**
 * 批8: 学科墨水的 **CSS 变量名**（`--subject-ink-1..6`）。值住在 style.css 的
 * 主题块里——浅色一套、暗色一套（浅色值在暗面上只有 2.16-3.47:1，几乎看不见）。
 * 渲染层只注入变量名，切主题不需要 JS 参与。
 *
 * 漂移守卫：tests/subject-ink.test.ts 断言 CSS 里的浅色 token 与上面的
 * SUBJECT_INKS 逐值一致、暗色 token 对 --surface 的对比度 ≥4.5。
 */
export function subjectInkVar(id: string): string {
  return `var(--subject-ink-${(hashString(id) % SUBJECT_INKS.length) + 1})`
}
