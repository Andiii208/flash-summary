import { useMemo, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { NoteIndexInfo } from '../../shared/bridge'
import { formatStamp } from '../../shared/format'

export interface NoteLibraryProps {
  entries: NoteIndexInfo[]
  /** Opening a library entry selects that lesson globally. */
  onOpenLesson: (lessonId: string) => void
  /** 质量批4: upgrade a course's stale notes (guarded when not provided). */
  onUpgradeCourse?: (courseId: string, label: string) => void
  /** Obsidian 批2: export the whole course into the vault. */
  onExportCourseObsidian?: (courseId: string, label: string) => void
  /** 健康巡查 2026-09-12 批5: the in-flight export kind — the course-export
   *  button reads «导出中…» and disables while any export runs. */
  exportBusy?: string | null
  /** 批2 (plan 2026-09-20, P17): 课程体检在飞——「升级旧笔记」读「读取中…」并禁用。 */
  upgradeBusy?: boolean
  /** 批C 批2: 搜索词（受控）——过滤在主进程做，这里只负责输入与展示。 */
  query?: string
  onQuery?: (value: string) => void
  /** 批C 批3: 满足条件的总数与「显示更多」（还有 M 条没取）。 */
  total?: number
  onMore?: () => void
}

interface LibraryGroup {
  label: string
  /** 质量批4: course identity for the upgrade entry (first non-null wins). */
  courseId: string | null
  items: NoteIndexInfo[]
}

/** 批6: group by course (· teacher) — a 200-row flat list across courses was
 *  unusable to scan; the group header carries the course identity so each
 *  row only needs the lesson title. */
function groupByCourse(entries: NoteIndexInfo[]): LibraryGroup[] {
  const map = new Map<string, LibraryGroup>()
  for (const entry of entries) {
    const label = [entry.courseName, entry.teacher].filter((s): s is string => s != null && s !== '').join(' · ')
    const key = label !== '' ? label : '其他笔记'
    const group = map.get(key) ?? { label: key, courseId: entry.courseId, items: [] }
    if (group.courseId == null && entry.courseId != null) group.courseId = entry.courseId
    group.items.push(entry)
    map.set(key, group)
  }
  return [...map.values()]
}

/**
 * 批B: cross-lesson note library — the notes tab empty state. Every generated
 * note is reachable without first picking a course in the sidebar; opening a
 * row selects that lesson so QA/exports/regenerate work immediately.
 * 2026-09-05: pure rows — the section heading lives with the caller.
 * 批6: course-grouped collapsible sections; v-badge explains itself.
 * 质量批4: per-course «升级旧笔记» entry in the group head.
 */
export function NoteLibrary({ entries, onOpenLesson, onUpgradeCourse, onExportCourseObsidian, exportBusy = null, upgradeBusy = false, query = '', onQuery, total, onMore }: NoteLibraryProps): JSX.Element {
  const groups = useMemo(() => groupByCourse(entries), [entries])
  const searching = query.trim() !== ''
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (label: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }
  return (
    <div class="note-library" data-testid="note-library">
      {/* 批C 批2: 搜索框跟着列表走（笔记库在「主页」与「已选课时」两处渲染，
          放组件里两处都有）。口径写在 placeholder 里：只搜列表看得见的字段。 */}
      {onQuery != null && (
        <input
          class="search-input note-library-search"
          type="search"
          placeholder="搜索笔记：课程 / 教师 / 课时…"
          aria-label="搜索笔记"
          value={query}
          onInput={(e) => onQuery((e.target as HTMLInputElement).value)}
        />
      )}
      {searching && entries.length === 0 && <p class="msg">没有匹配的笔记</p>}
      {groups.map((group) => {
        // 搜索时命中组一律展开——搜到了却看不见等于没搜到。
        const isCollapsed = searching ? false : collapsed.has(group.label)
        return (
          <div key={group.label} class="note-library-group">
            <div class="note-library-group-head">
              <button
                class="note-library-group-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => toggle(group.label)}
              >
                <span class="note-library-course" title={group.label}>
                  {group.label}
                </span>
                <span class="note-library-count">{group.items.length}</span>
              </button>
              {/* A2 (plan 2026-09-13): both actions in one right-flush cluster —
                  as the middle of three space-between children the export
                  button drifted with the course-name length (measured left
                  edges 941/775/743 across groups). */}
              <div class="note-library-actions">
                {onExportCourseObsidian != null && group.courseId != null && (
                  <button
                    class="btn small ghost note-library-upgrade"
                    title="整门课结构化导出到 Obsidian 仓库（含概念聚合页）"
                    disabled={exportBusy != null}
                    onClick={(e) => {
                      e.stopPropagation()
                      onExportCourseObsidian(group.courseId!, group.label)
                    }}
                  >
                    {exportBusy === 'course-obsidian' ? '导出中…' : '导出 Obsidian'}
                  </button>
                )}
                {onUpgradeCourse != null && group.courseId != null && (
                  <button
                    class="btn small note-library-upgrade"
                    title="按体检结果升级该课程的旧笔记（复用已落库转写，零下载）"
                    disabled={upgradeBusy}
                    onClick={(e) => {
                      e.stopPropagation()
                      onUpgradeCourse(group.courseId!, group.label)
                    }}
                  >
                    {upgradeBusy ? '读取中…' : '升级旧笔记'}
                  </button>
                )}
              </div>
            </div>
            {!isCollapsed &&
              group.items.map((entry) => {
                const lesson = entry.lessonTitle != null && entry.lessonTitle !== '' ? entry.lessonTitle : entry.lessonId
                return (
                  <button
                    key={`${entry.lessonId}-${entry.version}`}
                    class="item note-library-row"
                    data-testid="note-library-row"
                    title={`${group.label} — ${lesson}`}
                    onClick={() => onOpenLesson(entry.lessonId)}
                  >
                    <span class="note-library-lesson">{lesson}</span>
                    <span class="note-library-meta">
                      <span class="badge ok" title={`第 ${entry.version} 次生成`}>
                        v{entry.version}
                      </span>
                      {formatStamp(entry.createdAt)}
                    </span>
                  </button>
                )
              })}
          </div>
        )
      })}
      {/* 批C 批3: 「显示更多」沿用 M3-2 的「分块 + 显式展开」（不做虚拟滚动）。
          还有多少条按总数算——数字由数据给，不硬编码。 */}
      {onMore != null && total != null && total > entries.length && (
        <button class="btn small ghost list-more" onClick={onMore}>
          显示更多（还有 {total - entries.length} 条）
        </button>
      )}
    </div>
  )
}
