import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { CourseTreeInfo } from '../../shared/bridge'
import { courseMatchesQuery } from '../../shared/course-search'
import { courseAvatarChar, courseSubLine } from '../../shared/course-display'
import { subjectInk } from '../../shared/subject-ink'
import { useModalScrollLock } from '../ui/use-modal-scroll-lock'
import { useFocusTrap } from '../ui/use-focus-trap'

export interface CourseBrowserProps {
  open: boolean
  /** The full LOCAL catalog (state.tree) — the browser is a read view over it. */
  tree: CourseTreeInfo[]
  onClose: () => void
}

/** 批4 (plan 2026-09-13): chunked reveal — 1654 rows in one DOM is the slow
 *  path M3-2 already flagged for the sidebar; the grid shows 120, then waits
 *  for an explicit «显示更多». */
const CHUNK = 120

/**
 * 批4 (plan 2026-09-13, D5-A): near-fullscreen course browser — the sidebar
 * is 304px wide and truncates exactly the fields that tell 212 courses named
 * «学位英语» apart. Modal language follows CourseMapDialog: scroll lock, focus
 * trap, Esc + backdrop close. 批5 adds filters/sort and the per-card actions.
 */
export function CourseBrowser({ open, tree, onClose }: CourseBrowserProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(CHUNK)
  const cardRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useModalScrollLock(open)
  useFocusTrap(open, cardRef)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // A fresh open starts a fresh browse: no inherited query, focus in the box.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setVisible(CHUNK)
    searchRef.current?.focus()
  }, [open])

  const matches = useMemo(
    () => (query.trim() === '' ? tree : tree.filter((course) => courseMatchesQuery(course, query))),
    [tree, query]
  )

  if (!open) return null
  const shown = matches.slice(0, visible)
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
          <button class="btn small" onClick={onClose}>
            关闭
          </button>
        </div>
        <input
          ref={searchRef}
          class="search-input course-browser-search"
          type="search"
          placeholder="搜索课程 / 教师 / 教室 / 学期…"
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value)
            setVisible(CHUNK)
          }}
        />
        <div class="course-browser-body">
          {matches.length === 0 ? (
            <p class="course-browser-empty">没有匹配的课程——试试只搜教师名，或换个词。</p>
          ) : (
            <>
              <div class="course-browser-grid" data-testid="course-browser-grid">
                {shown.map((course) => (
                  <CourseCard key={course.id} course={course} />
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

/** 批4: display-only card; 批5 attaches expand/star/map/harvest/delete. */
function CourseCard({ course }: { course: CourseTreeInfo }): JSX.Element {
  const sub = courseSubLine(course)
  return (
    <article class="course-card" style={`--course-ink:${subjectInk(course.id)}`}>
      <div class="course-card-head">
        <span class="course-mono" aria-hidden="true">
          {courseAvatarChar(course.name)}
        </span>
        <span class="course-card-name" title={course.name}>
          {course.name}
        </span>
        {course.source === 'bilibili' && <span class="badge bili">B站</span>}
        {course.lessons.length > 0 && <span class="course-count">{course.lessons.length}</span>}
      </div>
      {sub != null && <div class="course-card-sub">{sub}</div>}
    </article>
  )
}
