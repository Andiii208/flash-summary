import type { JSX } from 'preact'
import type { CourseTreeInfo } from '../../shared/bridge'

export interface CourseTreeProps {
  tree: CourseTreeInfo[]
  selectedLesson: string
  /** Courses the user explicitly expanded; empty by default (all collapsed). */
  expanded: ReadonlySet<string>
  /** Non-empty while the user searches: matches render expanded regardless. */
  searching: boolean
  onToggle: (courseId: string) => void
  onSelect: (lessonId: string) => void
  onHarvestLessons: (courseId: string) => void
}

/** Sidebar course → lesson tree with search, count chips, and note badges. */
export function CourseTree({ tree, selectedLesson, expanded, searching, onToggle, onSelect, onHarvestLessons }: CourseTreeProps): JSX.Element {
  if (tree.length === 0) {
    return <p class="msg">{searching ? '没有匹配的课程' : '暂无课程，请先登录 CAS 刷新'}</p>
  }
  return (
    <div class="course-tree">
      {tree.map((course) => (
        <CourseRow
          key={course.id}
          course={course}
          expanded={searching || expanded.has(course.id)}
          selectedLesson={selectedLesson}
          onToggle={onToggle}
          onSelect={onSelect}
          onHarvestLessons={onHarvestLessons}
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
  onHarvestLessons: (courseId: string) => void
}

function CourseRow({ course, expanded, selectedLesson, onToggle, onSelect, onHarvestLessons }: CourseRowProps): JSX.Element {
  return (
    <div class="item course-item">
      <button class="course-head" onClick={() => onToggle(course.id)} aria-expanded={expanded}>
        <span class="caret">{expanded ? '▾' : '▸'}</span>
        <span class="course-name">{course.name}</span>
        {course.lessons.length > 0 && <span class="course-count">{course.lessons.length}</span>}
        <span class="course-meta">{course.term ?? course.teacher ?? ''}</span>
      </button>
      {expanded &&
        (course.lessons.length === 0 ? (
          <div class="lesson-row empty">
            还没有课时目录
            <button class="btn small" onClick={() => onHarvestLessons(course.id)}>
              抓取课时目录
            </button>
          </div>
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
