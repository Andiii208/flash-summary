/**
 * 批4 (plan 2026-09-13): the ONE course-search predicate, shared by the
 * sidebar's inline search and the fullscreen course browser (D7) — two
 * surfaces answering the same word differently would read as a bug.
 *
 * Matches name / teacher / term / classroom / courTimes / subject code /
 * course id / lesson titles, case-insensitively. The sidebar used to skip
 * classroom/courTimes/subjCode; with 1654 local courses (and 212 sharing the
 * name «学位英语») those fields are how you actually tell rows apart.
 */
import type { CourseTreeInfo } from './bridge'

export function courseMatchesQuery(course: CourseTreeInfo, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (query === '') return true
  const haystack = [course.name, course.teacher, course.term, course.classroom, course.courTimes, course.subjCode, course.id]
    .map((part) => part ?? '')
    .join(' ')
    .toLowerCase()
  return haystack.includes(query) || course.lessons.some((lesson) => lesson.title.toLowerCase().includes(query))
}
