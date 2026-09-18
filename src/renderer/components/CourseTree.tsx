import { useState } from 'preact/hooks'
import { ChevronDown, ChevronRight, GitBranch, Star, Trash2 } from 'lucide-preact'
import type { JSX } from 'preact'
import type { CourseTreeInfo } from '../../shared/bridge'
import { subjectInk } from '../../shared/subject-ink'
import { courseAvatarChar, courseSubLine } from '../../shared/course-display'
import { Dialog } from '../ui/Dialog'

export interface CourseTreeProps {
  tree: CourseTreeInfo[]
  selectedLesson: string
  /** Courses the user explicitly expanded; empty by default (all collapsed). */
  expanded: ReadonlySet<string>
  /** Non-empty while the user searches: matches render expanded regardless. */
  searching: boolean
  /** Same-subject sections of pinned courses, badged «同课» (C4). */
  sameCourseIds: ReadonlySet<string>
  /** 批C: courses whose «第N节课» catalog harvest is running. */
  harvestInflight?: ReadonlySet<string>
  /** 健康巡查 2026-09-12 批5: a course-map aggregation is in flight — every
   *  map button disables (aggregation can take seconds on large courses). */
  courseMapBusy?: boolean
  /** C6: remove an empty (never-processed) course. */
  onRemoveCourse?: (courseId: string) => void
  /** M4.1: open the course-level mind map dialog (决策点 D7 entry). */
  onCourseMap?: (courseId: string) => void
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
  harvestInflight,
  courseMapBusy,
  onRemoveCourse,
  onCourseMap,
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
          inflight={harvestInflight?.has(course.id) ?? false}
          mapBusy={courseMapBusy ?? false}
          onRemoveCourse={onRemoveCourse}
          onCourseMap={onCourseMap}
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
  /** 批C: this course's catalog harvest is currently running. */
  inflight: boolean
  /** 健康巡查 2026-09-12 批5: a course-map aggregation is in flight. */
  mapBusy: boolean
  /** C6: remove an empty course (propagated from CourseTree). */
  onRemoveCourse?: (courseId: string) => void
  onCourseMap?: (courseId: string) => void
  onToggle: (courseId: string) => void
  onSelect: (lessonId: string) => void
  onHarvestLessons: (courseId: string) => void
  onToggleMine: (courseId: string, mine: boolean) => void
}

function CourseRow({ course, expanded, selectedLesson, sameCourse, inflight, mapBusy, onRemoveCourse, onCourseMap, onToggle, onSelect, onHarvestLessons, onToggleMine }: CourseRowProps): JSX.Element {
  const sub = courseSubLine(course)
  // C6: only never-processed courses are deletable (cascade protection).
  const deletable = course.lessons.length === 0 && course.noteCount === 0 && onRemoveCourse != null
  const [pendingDelete, setPendingDelete] = useState(false)
  return (
    <div class="item course-item" style={`--course-ink:${subjectInk(course.id)}`}>
      <div class="course-row-head">
        <button class="course-head" onClick={() => onToggle(course.id)} aria-expanded={expanded} title={course.name}>
          <span class="caret">{expanded ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}</span>
          <span class="course-mono" aria-hidden="true">
            {courseAvatarChar(course.name)}
          </span>
          <span class="course-name">{course.name}</span>
          {course.source === 'bilibili' && <span class="badge bili">B站</span>}
          {sameCourse && <span class="badge same">同课</span>}
          {course.lessons.length > 0 && <span class="course-count">{course.lessons.length}</span>}
        </button>
        {/* 批6 (T40): 三键顺序与全屏浏览页统一为「星标 → 导图 → 删除」——收藏最常用
            在前，破坏性动作最后（远离其余两键）；此前两处顺序互为镜像。 */}
        <button
          class={`pin-btn${course.isMine === true ? ' pinned' : ''}`}
          title={course.isMine === true ? '取消收藏标记' : '收藏这门课（排序置顶）'}
          aria-label={course.isMine === true ? `取消收藏 ${course.name}` : `收藏课程 ${course.name}`}
          aria-pressed={course.isMine === true}
          onClick={() => onToggleMine(course.id, course.isMine !== true)}
        >
          <Star size={14} strokeWidth={1.75} fill={course.isMine === true ? 'currentColor' : 'none'} />
        </button>
        {onCourseMap != null && (
          <button
            class="pin-btn"
            title={mapBusy ? '正在聚合课程导图…' : `查看「${course.name}」的课程导图`}
            aria-label={`查看课程导图 ${course.name}`}
            disabled={mapBusy}
            onClick={() => onCourseMap(course.id)}
          >
            <GitBranch size={13} strokeWidth={1.75} />
          </button>
        )}
        {deletable && (
          <button class="pin-btn" title="删除这门课（未产生过笔记/任务）" aria-label={`删除课程 ${course.name}`} onClick={() => setPendingDelete(true)}>
            <Trash2 size={13} strokeWidth={1.75} />
          </button>
        )}
      </div>
      <Dialog
        open={pendingDelete}
        title={`删除课程「${course.name}」？`}
        message="只删除这条从未使用过的课程记录；一旦产生过笔记或任务，应用会拒绝删除以保护数据。"
        confirmLabel="删除"
        danger
        onConfirm={() => {
          setPendingDelete(false)
          onRemoveCourse?.(course.id)
        }}
        onCancel={() => setPendingDelete(false)}
      />
      {sub != null && <div class="course-sub">{sub}</div>}
      {expanded &&
        (course.lessons.length === 0 ? (
          <div class="lesson-row empty">
            {inflight ? '正在抓取课时目录…' : '还没有课时目录'}
            {!inflight && (
              <button class="btn small" onClick={() => onHarvestLessons(course.id)}>
                抓取课时目录
              </button>
            )}
          </div>
        ) : (
          course.lessons.map((lesson) => (
            <button
              key={lesson.id}
              class={`lesson-row${lesson.id === selectedLesson ? ' selected' : ''}`}
              title={lesson.title}
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
