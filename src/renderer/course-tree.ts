/**
 * Course → lesson tree rendering (U1). Courses expand/collapse; lesson rows
 * are selectable and carry a "has note" badge. Pure DOM, no state of its
 * own: collapsed/selected sets are owned by the caller.
 */
import type { CourseTreeInfo } from '../shared/bridge'

export interface CourseTreeCallbacks {
  onToggleCourse: (courseId: string) => void
  onLessonSelect: (lessonId: string) => void
}

export function renderCourseTree(
  container: HTMLElement,
  tree: CourseTreeInfo[],
  collapsed: ReadonlySet<string>,
  selectedLesson: string,
  cb: CourseTreeCallbacks
): void {
  container.textContent = ''
  for (const course of tree) {
    container.appendChild(renderCourse(course, collapsed, selectedLesson, cb))
  }
}

function renderCourse(
  course: CourseTreeInfo,
  collapsed: ReadonlySet<string>,
  selectedLesson: string,
  cb: CourseTreeCallbacks
): HTMLElement {
  const item = document.createElement('div')
  item.className = 'item course-item'
  const head = document.createElement('div')
  head.className = 'course-head'
  head.textContent = `${collapsed.has(course.id) ? '▸' : '▾'} ${course.name}（${course.term ?? course.teacher ?? course.id}）`
  head.addEventListener('click', () => cb.onToggleCourse(course.id))
  item.appendChild(head)

  if (collapsed.has(course.id)) return item
  if (course.lessons.length === 0) {
    item.appendChild(Object.assign(document.createElement('div'), { className: 'lesson-row empty', textContent: '  无课时（可用手动添加后备入口）' }))
    return item
  }
  for (const lesson of course.lessons) {
    item.appendChild(renderLesson(lesson.id, lesson.title, lesson.hasNote, lesson.id === selectedLesson, cb))
  }
  return item
}

function renderLesson(
  lessonId: string,
  title: string,
  hasNote: boolean,
  selected: boolean,
  cb: CourseTreeCallbacks
): HTMLElement {
  const row = document.createElement('div')
  row.className = `lesson-row${selected ? ' selected' : ''}`
  const name = document.createElement('span')
  name.textContent = title
  const badge = document.createElement('span')
  badge.className = `badge${hasNote ? ' ok' : ''}`
  badge.textContent = hasNote ? '已处理✓' : '未处理'
  row.append(name, badge)
  row.addEventListener('click', () => cb.onLessonSelect(lessonId))
  return row
}
