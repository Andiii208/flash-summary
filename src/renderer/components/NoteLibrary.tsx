import type { JSX } from 'preact'
import type { NoteIndexInfo } from '../../shared/bridge'

export interface NoteLibraryProps {
  entries: NoteIndexInfo[]
  /** Opening a library entry selects that lesson globally. */
  onOpenLesson: (lessonId: string) => void
}

/** «YYYY-MM-DD HH:mm» short stamp for library rows. */
function formatStamp(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

/** Row label: course · teacher · lesson, falling back to the raw lesson id. */
function entryLabel(entry: NoteIndexInfo): { title: string; meta: string | null } {
  const course = [entry.courseName, entry.teacher].filter((s): s is string => s != null && s !== '').join(' · ')
  const lesson = entry.lessonTitle != null && entry.lessonTitle !== '' ? entry.lessonTitle : entry.lessonId
  return { title: course !== '' ? `${course} — ${lesson}` : lesson, meta: formatStamp(entry.createdAt) }
}

/**
 * 批B: cross-lesson note library — the notes tab empty state. Every generated
 * note is reachable without first picking a course in the sidebar; opening a
 * row selects that lesson so QA/exports/regenerate work immediately.
 */
export function NoteLibrary({ entries, onOpenLesson }: NoteLibraryProps): JSX.Element {
  return (
    <div class="note-library" data-testid="note-library">
      <p class="msg">全部笔记（最近 200 条）— 点击一条即可查看与追问</p>
      {entries.map((entry) => {
        const label = entryLabel(entry)
        return (
          <button
            key={`${entry.lessonId}-${entry.version}`}
            class="item note-library-row"
            data-testid="note-library-row"
            title={label.title}
            onClick={() => onOpenLesson(entry.lessonId)}
          >
            <span class="note-library-course">{label.title}</span>
            <span class="note-library-meta">
              <span class="badge ok">v{entry.version}</span>
              {label.meta}
            </span>
          </button>
        )
      })}
    </div>
  )
}
