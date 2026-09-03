import type { JSX } from 'preact'
import type { CourseTreeInfo } from '../../shared/bridge'

export interface CourseTreeProps {
  tree: CourseTreeInfo[]
  selectedLesson: string
  /** Courses the user explicitly expanded; empty by default (all collapsed). */
  expanded: ReadonlySet<string>
  /** Non-empty while the user searches: matches render expanded regardless. */
  searching: boolean
  /** Same-subject sections of pinned courses, badged «同课» (C4). */
  sameCourseIds: ReadonlySet<string>
  onToggle: (courseId: string) => void
  onSelect: (lessonId: string) => void
  onHarvestLessons: (courseId: string) => void
  onToggleMine: (courseId: string, mine: boolean) => void
}

/** Sidebar course → lesson tree with search, count chips, and note badges. */
export function CourseTree({
  tree,
  selectedLesson,
  expanded,
  searching,
  sameCourseIds,
  onToggle,
  onSelect,
  onHarvestLessons,
  onToggleMine
}: CourseTreeProps): JSX.Element {
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
          sameCourse={sameCourseIds.has(course.id)}
          onToggle={onToggle}
          onSelect={onSelect}
          onHarvestLessons={onHarvestLessons}
          onToggleMine={onToggleMine}
        />
      ))}
    </div>
  )
}

interface CourseRowProps {
  course: CourseTreeInfo
  expanded: boolean
  selectedLesson: string
  sameCourse: boolean
  onToggle: (courseId: string) => void
  onSelect: (lessonId: string) => void
  onHarvestLessons: (courseId: string) => void
  onToggleMine: (courseId: string, mine: boolean) => void
}

/** Teacher / meeting-times / classroom sub line, as the official site shows (C3). */
function courseSubLine(course: CourseTreeInfo): string | null {
  const parts = [course.teacher, course.courTimes, course.classroom].filter((p): p is string => p != null && p !== '')
  return parts.length > 0 ? parts.join(' · ') : null
}

function CourseRow({ course, expanded, selectedLesson, sameCourse, onToggle, onSelect, onHarvestLessons, onToggleMine }: CourseRowProps): JSX.Element {
  const sub = courseSubLine(course)
  return (
    <div class="item course-item">
      <div class="course-row-head">
        <button class="course-head" onClick={() => onToggle(course.id)} aria-expanded={expanded}>
          <span class="caret">{expanded ? '▾' : '▸'}</span>
          <span class="course-name">{course.name}</span>
          {sameCourse && <span class="badge same">同课</span>}
          {course.lessons.length > 0 && <span class="course-count">{course.lessons.length}</span>}
          <span class="course-meta">{course.term ?? ''}</span>
        </button>
        <button
          class={`pin-btn${course.isMine === true ? ' pinned' : ''}`}
          title={course.isMine === true ? '取消「我的课程」标记' : '标记为「我的课程」（排序置顶）'}
          aria-pressed={course.isMine === true}
          onClick={() => onToggleMine(course.id, course.isMine !== true)}
        >
          {course.isMine === true ? '★' : '☆'}
        </button>
      </div>
      {sub != null && <div class="course-sub">{sub}</div>}
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
