import { useMemo, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { NoteIndexInfo } from '../../shared/bridge'

export interface NoteLibraryProps {
  entries: NoteIndexInfo[]
  /** Opening a library entry selects that lesson globally. */
  onOpenLesson: (lessonId: string) => void
}

/** «YYYY-MM-DD HH:mm» short stamp; invalid input degrades to «—» (批6). */
function formatStamp(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

interface LibraryGroup {
  label: string
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
    const group = map.get(key) ?? { label: key, items: [] }
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
 */
export function NoteLibrary({ entries, onOpenLesson }: NoteLibraryProps): JSX.Element {
  const groups = useMemo(() => groupByCourse(entries), [entries])
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
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.label)
        return (
          <div key={group.label} class="note-library-group">
            <button class="note-library-group-head" aria-expanded={!isCollapsed} onClick={() => toggle(group.label)}>
              <span class="note-library-course">{group.label}</span>
              <span class="note-library-count">{group.items.length}</span>
            </button>
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
    </div>
  )
}
