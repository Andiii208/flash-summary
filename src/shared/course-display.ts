/**
 * Course display helpers shared by the sidebar tree and the fullscreen
 * course browser (plan 2026-09-13 批4).
 */
import type { CourseTreeInfo } from './bridge'

/**
 * A6 (plan 2026-09-13): the course avatar shows ONE glyph from the course
 * name as a fast discriminator in a catalog full of look-alike rows. Course
 * names often open with punctuation (Bilibili: «（中英字幕完结）斯坦福CS224N…»
 * rendered as a lone «（» before this) — skip anything that is not a
 * letter/digit (CJK counts as a letter) and fall back to the raw first
 * character when the name is all punctuation.
 */
export function courseAvatarChar(name: string): string {
  const meaningful = name.match(/\p{L}|\p{N}/u)
  if (meaningful != null) return meaningful[0]
  return name.slice(0, 1)
}

/**
 * Teacher / times / classroom / term secondary line, official-site parity
 * (usability overhaul C3). Moved here in 批4 (plan 2026-09-13) so the
 * fullscreen course browser shows the SAME disambiguation line as the
 * sidebar — with 212 courses named «学位英语», teacher/room is the identity.
 */
export function courseSubLine(course: CourseTreeInfo): string | null {
  const parts = [course.teacher, course.courTimes, course.classroom, course.term].filter(
    (p): p is string => p != null && p !== ''
  )
  return parts.length > 0 ? parts.join(' · ') : null
}
