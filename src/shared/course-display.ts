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
 * Teacher / times / classroom / term secondary parts, official-site parity
 * (usability overhaul C3). 批5 (plan 2026-09-13) splits them out so the
 * course browser can render the teacher as a separate filter chip while the
 * sidebar keeps the joined line — with 212 courses named «学位英语»,
 * teacher/room is the identity.
 */
export function courseSubParts(course: CourseTreeInfo): string[] {
  return [course.teacher, course.courTimes, course.classroom, course.term].filter(
    (p): p is string => p != null && p !== ''
  )
}

export function courseSubLine(course: CourseTreeInfo): string | null {
  const parts = courseSubParts(course)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Chinese ordinal for the platform's acteTerm values (1/2 = 上学期/下学期,
 * 3 = 小学期). One definition shared by the term catalog parser (main) and
 * the course-term renderer (renderer) — plan 2026-10-07.
 */
export function termOrdinal(term: number): string {
  switch (term) {
    case 1:
      return '第一'
    case 2:
      return '第二'
    case 3:
      return '第三'
    default:
      return `第${term}`
  }
}

/**
 * Display label for a stored course term: `2026-2027-2` → `2026-2027
 * 第二学期`. Legacy rows harvested before the acteId semester filter carry
 * the year range only (`2026-2027`) and pass through unchanged, as does
 * anything unrecognized.
 */
export function termLabel(term: string): string {
  const match = /^(\d{4}-\d{4})-(\d+)$/.exec(term)
  return match == null ? term : `${match[1]} ${termOrdinal(Number(match[2]))}学期`
}
