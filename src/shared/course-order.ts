/**
 * Sidebar ordering for the «my courses» recommendation (C2/C4 + M1-4).
 *
 * Pure over the renderer tree type so it is unit-testable and shared by the
 * search filter and the component. Tiering:
 *   1. pinned courses (isMine)
 *   2. courses the user already extracted (hasExtracted: has notes) — the
 *      user's actual study material floats up without any manual action
 *   3. other teachers' sections of the same subjects (subjCode match) — the
 *      «同课程其他老师» recommendation
 *   4. everything else (order preserved)
 */
import type { CourseTreeInfo } from './bridge'

export interface OrderedCourseTree {
  tree: CourseTreeInfo[]
  /** Course ids in tier 3, so the UI can badge them «同课». */
  sameCourseIds: ReadonlySet<string>
}

export function orderMyCoursesFirst(tree: CourseTreeInfo[]): OrderedCourseTree {
  const mineSubjCodes = new Set(
    tree.filter((c) => c.isMine === true && c.subjCode != null && c.subjCode !== '').map((c) => c.subjCode as string)
  )
  const tier1: CourseTreeInfo[] = []
  const tierExtracted: CourseTreeInfo[] = []
  const tierSame: CourseTreeInfo[] = []
  const tierRest: CourseTreeInfo[] = []
  for (const course of tree) {
    if (course.isMine === true) tier1.push(course)
    else if (course.hasExtracted === true) tierExtracted.push(course)
    else if (course.subjCode != null && mineSubjCodes.has(course.subjCode)) tierSame.push(course)
    else tierRest.push(course)
  }
  return { tree: [...tier1, ...tierExtracted, ...tierSame, ...tierRest], sameCourseIds: new Set(tierSame.map((c) => c.id)) }
}
