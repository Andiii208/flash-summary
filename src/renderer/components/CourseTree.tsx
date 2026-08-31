import type { JSX } from 'preact'
import type { CourseTreeInfo } from '../../shared/bridge'

export interface CourseTreeProps {
  tree: CourseTreeInfo[]
  selectedLesson: string
  collapsed: ReadonlySet<string>
  onToggle: (courseId: string) => void
  onSelect: (lessonId: string) => void
}

/** Sidebar course → lesson tree with hasNote badges (U2). */
export function CourseTree({ tree, selectedLesson, collapsed, onToggle, onSelect }: CourseTreeProps): JSX.Element {
  if (tree.length === 0) {
    return <p class="msg">暂无课程，请先登录 CAS 刷新</p>
  }
  return (
    <div class="course-tree">
      {tree.map((course) => (
        <CourseRow
          key={course.id}
          course={course}
          expanded={!collapsed.has(course.id)}
          selectedLesson={selectedLesson}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

interface CourseRowProps {
  course: CourseTreeInfo
  expanded: boolean
  selectedLesson: string
  onToggle: (courseId: string) => void
  onSelect: (lessonId: string) => void
}

function CourseRow({ course, expanded, selectedLesson, onToggle, onSelect }: CourseRowProps): JSX.Element {
  return (
    <div class="item course-item">
      <button class="course-head" onClick={() => onToggle(course.id)} aria-expanded={expanded}>
        <span class="caret">{expanded ? '▾' : '▸'}</span>
        {course.name}
        <span class="course-meta">（{course.term ?? course.teacher ?? course.id}）</span>
      </button>
      {expanded &&
        (course.lessons.length === 0 ? (
          <div class="lesson-row empty">无课时（可用手动添加后备入口）</div>
        ) : (
          course.lessons.map((lesson) => (
            <button
              key={lesson.id}
              class={`lesson-row${lesson.id === selectedLesson ? ' selected' : ''}`}
              onClick={() => onSelect(lesson.id)}
            >
              <span class="lesson-title">{lesson.title}</span>
              <span class={`badge${lesson.hasNote ? ' ok' : ''}`}>{lesson.hasNote ? '已处理✓' : '未处理'}</span>
            </button>
          ))
        ))}
    </div>
  )
}
