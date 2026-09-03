/**
 * Sidebar ordering for the «my courses» recommendation (C2/C4, 2026-09-03).
 *
 * Pure over the renderer tree type so it is unit-testable and shared by the
 * search filter and the component. Tiering:
 *   1. pinned courses (isMine)
 *   2. other teachers' sections of the same subjects (subjCode match) — the
 *      «同课程其他老师» recommendation
 *   3. everything else (order preserved)
 */
import type { CourseTreeInfo } from './bridge'

export interface OrderedCourseTree {
  tree: CourseTreeInfo[]
  /** Course ids in tier 2, so the UI can badge them «同课». */
  sameCourseIds: ReadonlySet<string>
}

export function orderMyCoursesFirst(tree: CourseTreeInfo[]): OrderedCourseTree {
  const mineSubjCodes = new Set(
    tree.filter((c) => c.isMine === true && c.subjCode != null && c.subjCode !== '').map((c) => c.subjCode as string)
  )
  const tier1: CourseTreeInfo[] = []
  const tier2: CourseTreeInfo[] = []
  const tier3: CourseTreeInfo[] = []
  for (const course of tree) {
    if (course.isMine === true) tier1.push(course)
    else if (course.subjCode != null && mineSubjCodes.has(course.subjCode)) tier2.push(course)
    else tier3.push(course)
  }
  return { tree: [...tier1, ...tier2, ...tier3], sameCourseIds: new Set(tier2.map((c) => c.id)) }
}
