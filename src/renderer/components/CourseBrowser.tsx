import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { ChevronDown, ChevronRight, GitBranch, Star, Trash2 } from 'lucide-preact'
import type { CourseTreeInfo } from '../../shared/bridge'
import { courseMatchesQuery } from '../../shared/course-search'
import { courseAvatarChar, courseSubParts } from '../../shared/course-display'
import { orderMyCoursesFirst } from '../../shared/course-order'
import { subjectInkVar } from '../../shared/subject-ink'
import { Dialog } from '../ui/Dialog'
import { useModalScrollLock } from '../ui/use-modal-scroll-lock'
import { useFocusTrap } from '../ui/use-focus-trap'
import { isTopmostModalLayer } from '../ui/modal-layer'

export interface CourseBrowserProps {
  open: boolean
  /** The full LOCAL catalog (state.tree) — the browser is a read view over it. */
  tree: CourseTreeInfo[]
  /** Currently selected lesson, highlighted inside an expanded card. */
  selectedLessonId?: string
  /** 批5: the same handlers the sidebar rows use. */
  onSelectLesson: (lessonId: string) => void
  /** 批6 (H21): 可返回 Promise——星标据此在途禁用（连点发两次 setMine）。 */
  onToggleMine: (courseId: string, mine: boolean) => void | Promise<void>
  onHarvestLessons?: (courseId: string) => void
  onRemoveCourse?: (courseId: string) => void
  onCourseMap?: (courseId: string) => void
  /** 批C: courses whose catalog harvest is running (mirrors the sidebar badge). */
  harvestInflight?: ReadonlySet<string>
  /** 健康巡查批5: a course-map aggregation is running — map buttons disable. */
  courseMapBusy?: boolean
  onClose: () => void
}

/** 批4 (plan 2026-09-13): chunked reveal — 1654 rows in one DOM is the slow
 *  path M3-2 already flagged for the sidebar; the grid shows 120, then waits
 *  for an explicit «显示更多». */
const CHUNK = 120

type SourceFilter = 'all' | 'seu' | 'bilibili'
type SortMode = 'default' | 'name' | 'teacher' | 'recent'

/** 批5: status chips — multi-select, UNION semantics (any checked trait). */
interface StatusDef {
  id: 'extracted' | 'mine' | 'cataloged' | 'untouched'
  label: string
  title: string
  match: (course: CourseTreeInfo) => boolean
}

const STATUS_DEFS: StatusDef[] = [
  { id: 'extracted', label: '已提取', title: '生成过笔记的课', match: (c) => c.hasExtracted === true },
  { id: 'mine', label: '已收藏', title: '星标收藏的课', match: (c) => c.isMine === true },
  { id: 'cataloged', label: '有课时目录', title: '抓取过课时目录的课', match: (c) => c.lessons.length > 0 },
  { id: 'untouched', label: '从未处理', title: '没有课时目录也没有笔记的课（可清理）', match: (c) => c.lessons.length === 0 && c.noteCount === 0 }
]

const TERM_NULL = '__term_null__'

/**
 * 批4 (plan 2026-09-13, D5-A): near-fullscreen course browser — the sidebar
 * is 304px wide and truncates exactly the fields that tell 212 courses named
 * «学位英语» apart. Modal language follows CourseMapDialog: scroll lock, focus
 * trap, Esc + backdrop close.
 * 批5: 学期/来源/状态筛选 + 排序 + 教师 chip + 卡片展开课时与行内操作.
 */
export function CourseBrowser({
  open,
  tree,
  selectedLessonId,
  onSelectLesson,
  onToggleMine,
  onHarvestLessons,
  onRemoveCourse,
  onCourseMap,
  harvestInflight,
  courseMapBusy = false,
  onClose
}: CourseBrowserProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(CHUNK)
  const [term, setTerm] = useState('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [statuses, setStatuses] = useState<ReadonlySet<StatusDef['id']>>(new Set())
  const [teacher, setTeacher] = useState<string | null>(null)
  const [sort, setSort] = useState<SortMode>('default')
  const cardRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useModalScrollLock(open)
  useFocusTrap(open, cardRef)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      // 批1 (P13 验收项「Esc 只关一层」): 被压在课程导图/我的学习弹层下面时不响应。
      if (e.key === 'Escape' && isTopmostModalLayer(cardRef.current)) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // A fresh open starts a fresh browse: no inherited filters, focus in the box.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setVisible(CHUNK)
    setTerm('all')
    setSource('all')
    setStatuses(new Set())
    setTeacher(null)
    setSort('default')
    searchRef.current?.focus()
  }, [open])

  const terms = useMemo(() => {
    const set = new Set<string>()
    for (const course of tree) {
      if (course.term != null && course.term !== '') set.add(course.term)
    }
    return [...set].sort((a, b) => b.localeCompare(a))
  }, [tree])

  const matches = useMemo(() => {
    const filtered = tree.filter((course) => {
      if (term !== 'all') {
        if (term === TERM_NULL && course.term != null && course.term !== '') return false
        if (term !== TERM_NULL && course.term !== term) return false
      }
      if (source !== 'all' && course.source !== source) return false
      if (statuses.size > 0 && ![...statuses].some((id) => STATUS_DEFS.find((def) => def.id === id)?.match(course) === true)) return false
      if (teacher != null && course.teacher !== teacher) return false
      return courseMatchesQuery(course, query)
    })
    switch (sort) {
      case 'name':
        return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      case 'teacher':
        return [...filtered].sort((a, b) => (a.teacher ?? '').localeCompare(b.teacher ?? '', 'zh-CN'))
      case 'recent':
        return [...filtered].sort((a, b) => (b.lastTaskAt ?? '').localeCompare(a.lastTaskAt ?? ''))
      case 'default':
        return orderMyCoursesFirst(filtered).tree
    }
  }, [tree, term, source, statuses, teacher, query, sort])

  if (!open) return null
  const shown = matches.slice(0, visible)
  const filtersActive = term !== 'all' || source !== 'all' || statuses.size > 0 || teacher != null || sort !== 'default' || query.trim() !== ''
  const clearFilters = (): void => {
    setQuery('')
    setTerm('all')
    setSource('all')
    setStatuses(new Set())
    setTeacher(null)
    setSort('default')
    setVisible(CHUNK)
  }
  const toggleStatus = (id: StatusDef['id']): void => {
    setVisible(CHUNK)
    setStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <div
      class="course-browser-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div class="course-browser-card" role="dialog" aria-modal="true" aria-label="全部课程" data-testid="course-browser" ref={cardRef}>
        <div class="course-browser-head">
          <div>
            <h2>全部课程</h2>
            <p class="course-browser-meta" data-testid="course-browser-meta">
              {matches.length === tree.length
                ? `本地已收录 ${tree.length} 门 · 搜索只查本地已收录的课`
                : `匹配 ${matches.length} 门 / 本地已收录 ${tree.length} 门 · 搜索只查本地已收录的课`}
            </p>
          </div>
          <button class="btn small" onClick={onClose} aria-label="关闭全部课程">
            关闭
          </button>
        </div>
        <input
          ref={searchRef}
          class="search-input course-browser-search"
          type="search"
          placeholder="搜索课程 / 教师 / 教室 / 学期…"
          aria-label="搜索课程"
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value)
            setVisible(CHUNK)
          }}
        />
        <div class="course-browser-filters">
          <select
            class="course-browser-select"
            aria-label="按学期筛选"
            value={term}
            onChange={(e) => {
              setTerm((e.target as HTMLSelectElement).value)
              setVisible(CHUNK)
            }}
          >
            <option value="all">全部学期</option>
            {terms.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={TERM_NULL}>（无学期）</option>
          </select>
          <select
            class="course-browser-select"
            aria-label="按来源筛选"
            value={source}
            onChange={(e) => {
              setSource((e.target as HTMLSelectElement).value as SourceFilter)
              setVisible(CHUNK)
            }}
          >
            <option value="all">全部来源</option>
            <option value="seu">校内课程</option>
            <option value="bilibili">B站视频</option>
          </select>
          <div class="filter-chips" role="group" aria-label="按状态筛选">
            {STATUS_DEFS.map((def) => (
              <button
                key={def.id}
                class={`chip${statuses.has(def.id) ? ' active' : ''}`}
                aria-pressed={statuses.has(def.id)}
                title={def.title}
                onClick={() => toggleStatus(def.id)}
              >
                {def.label}
              </button>
            ))}
          </div>
          {teacher != null && (
            <button class="chip active" title="点掉这个筛选" onClick={() => { setTeacher(null); setVisible(CHUNK) }}>
              教师：{teacher} ×
            </button>
          )}
          <select
            class="course-browser-select"
            aria-label="排序"
            value={sort}
            onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortMode)}
          >
            <option value="default">默认排序</option>
            <option value="name">按课程名</option>
            <option value="teacher">按教师</option>
            <option value="recent">按最近任务</option>
          </select>
          {filtersActive && (
            <button class="btn small ghost" onClick={clearFilters}>
              清除筛选
            </button>
          )}
        </div>
        <div class="course-browser-body">
          {matches.length === 0 ? (
            <p class="course-browser-empty">没有匹配的课程——试试只搜教师名，或清除筛选。</p>
          ) : (
            <>
              <div class="course-browser-grid" data-testid="course-browser-grid">
                {shown.map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    selectedLessonId={selectedLessonId}
                    onSelectLesson={onSelectLesson}
                    onClose={onClose}
                    onToggleMine={onToggleMine}
                    onHarvestLessons={onHarvestLessons}
                    onRemoveCourse={onRemoveCourse}
                    onCourseMap={onCourseMap}
                    onTeacherPick={(name) => { setTeacher(name); setVisible(CHUNK) }}
                    inflight={harvestInflight?.has(course.id) ?? false}
                    mapBusy={courseMapBusy}
                  />
                ))}
              </div>
              {matches.length > shown.length && (
                <button class="btn small ghost course-browser-more" onClick={() => setVisible((n) => n + CHUNK)}>
                  显示更多（还有 {matches.length - shown.length} 门）
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface CourseCardProps {
  course: CourseTreeInfo
  selectedLessonId?: string
  onSelectLesson: (lessonId: string) => void
  onClose: () => void
  /** 批6 (H21): 可返回 Promise——星标据此在途禁用（连点发两次 setMine）。 */
  onToggleMine: (courseId: string, mine: boolean) => void | Promise<void>
  onHarvestLessons?: (courseId: string) => void
  onRemoveCourse?: (courseId: string) => void
  onCourseMap?: (courseId: string) => void
  onTeacherPick: (teacher: string) => void
  inflight: boolean
  mapBusy: boolean
}

/** 批5: the card is the browser's row — expand for lessons, star/map/delete
 *  mirror the sidebar row's actions, the teacher name filters by that teacher.
 *  Picking a lesson selects it and closes the browser: the shortest path from
 *  «几百门课» to «这一节». */
function CourseCard({ course, selectedLessonId, onSelectLesson, onClose, onToggleMine, onHarvestLessons, onRemoveCourse, onCourseMap, onTeacherPick, inflight, mapBusy }: CourseCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  // C6: only never-processed courses are deletable (cascade protection) —
  // same rule the sidebar row uses.
  const deletable = course.lessons.length === 0 && course.noteCount === 0 && onRemoveCourse != null
  const [pendingDelete, setPendingDelete] = useState(false)
  // 批6 (H21): 与侧栏同一把尺——星标在途禁用（连点发两次 setMine）
  const [pinBusy, setPinBusy] = useState(false)
  const pinBusyRef = useRef(false)
  const onPin = (): void => {
    if (pinBusyRef.current) return
    pinBusyRef.current = true
    setPinBusy(true)
    void (async () => {
      try {
        await onToggleMine(course.id, course.isMine !== true)
      } finally {
        pinBusyRef.current = false
        setPinBusy(false)
      }
    })()
  }
  const parts = courseSubParts(course)
  const rest = course.teacher != null && course.teacher !== '' ? parts.slice(1) : parts
  return (
    <article class="course-card" style={`--course-ink:${subjectInkVar(course.id)}`}>
      <div class="course-card-head">
        <button class="course-card-main" aria-expanded={expanded} title={course.name} onClick={() => setExpanded((v) => !v)}>
          <span class="caret">{expanded ? <ChevronDown size={11} strokeWidth={1.75} /> : <ChevronRight size={11} strokeWidth={1.75} />}</span>
          <span class="course-mono" aria-hidden="true">
            {courseAvatarChar(course.name)}
          </span>
          <span class="course-card-name">{course.name}</span>
          {course.source === 'bilibili' && <span class="badge bili">B站</span>}
          {course.lessons.length > 0 && <span class="course-count">{course.lessons.length}</span>}
        </button>
        <button
          class={`pin-btn${course.isMine === true ? ' pinned' : ''}`}
          title={course.isMine === true ? '取消收藏标记' : '收藏这门课（排序置顶）'}
          aria-label={course.isMine === true ? `取消收藏 ${course.name}` : `收藏课程 ${course.name}`}
          aria-pressed={course.isMine === true}
          disabled={pinBusy}
          onClick={onPin}
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
      {parts.length > 0 && (
        <div class="course-card-sub">
          {course.teacher != null && course.teacher !== '' ? (
            <>
              <button class="course-card-teacher" title={`只看 ${course.teacher} 的课`} onClick={() => onTeacherPick(course.teacher!)}>
                {course.teacher}
              </button>
              {rest.length > 0 && <span> · </span>}
              {rest.join(' · ')}
            </>
          ) : (
            parts.join(' · ')
          )}
        </div>
      )}
      {expanded &&
        (course.lessons.length === 0 ? (
          <div class="course-card-lessons-empty">
            {/* 批6 (H21): 与侧栏同改——在途时按钮不再整颗卸载（第三种 busy 形态），
                改为 disabled + 「抓取中…」 */}
            {inflight ? '正在抓取课时目录…' : '还没有课时目录'}
            {onHarvestLessons != null && (
              <button class="btn small" onClick={() => onHarvestLessons(course.id)} disabled={inflight}>
                {inflight ? '抓取中…' : '抓取课时目录'}
              </button>
            )}
          </div>
        ) : (
          <div class="course-card-lessons">
            {course.lessons.map((lesson) => (
              <button
                key={lesson.id}
                class={`course-card-lesson${lesson.id === selectedLessonId ? ' selected' : ''}`}
                title={lesson.title}
                onClick={() => {
                  onSelectLesson(lesson.id)
                  onClose()
                }}
              >
                <span class="course-card-lesson-title">{lesson.title}</span>
                <span class={`badge${lesson.hasNote ? ' ok' : ''}`}>{lesson.hasNote ? '已处理✓' : '未处理'}</span>
              </button>
            ))}
          </div>
        ))}
      {pendingDelete && (
        <Dialog
          open
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
      )}
    </article>
  )
}
