import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { ChevronDown } from 'lucide-preact'

/** One sibling lesson in the quick-switch dropdown. */
export interface LessonChipLesson {
  id: string
  title: string
  hasNote?: boolean
}

export interface LessonChipProps {
  courseName: string
  lessonTitle: string
  /** Sibling lessons of the same course — enables the quick-switch dropdown. */
  lessons?: LessonChipLesson[]
  currentLessonId?: string
  onSelectLesson?: (lessonId: string) => void
}

/**
 * 批A: the «you are here» identity capsule — course · lesson. With sibling
 * lessons it becomes a quick-switch dropdown; without, a passive label.
 */
export function LessonChip({ courseName, lessonTitle, lessons, currentLessonId, onSelectLesson }: LessonChipProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const switchable = (lessons?.length ?? 0) > 0 && onSelectLesson != null

  // Click-outside closes the dropdown (mousedown so it beats the blur).
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (rootRef.current != null && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <span class="lesson-chip" ref={rootRef}>
      <button
        class="lesson-chip-btn"
        title={`${courseName} · ${lessonTitle}${switchable ? '（点击切换本课课时）' : ''}`}
        aria-expanded={switchable ? open : undefined}
        onClick={switchable ? () => setOpen((o) => !o) : undefined}
      >
        <span class="lesson-chip-course">{courseName}</span>
        <span class="lesson-chip-dot" aria-hidden="true">
          ·
        </span>
        <span class="lesson-chip-lesson">{lessonTitle}</span>
        {switchable && <ChevronDown size={12} strokeWidth={1.75} class={`chip-caret${open ? ' open' : ''}`} />}
      </button>
      {open && switchable && (
        <div class="lesson-chip-menu" role="menu">
          {lessons!.map((lesson) => (
            <button
              key={lesson.id}
              role="menuitem"
              class={lesson.id === currentLessonId ? 'active' : ''}
              onClick={() => {
                setOpen(false)
                if (lesson.id !== currentLessonId) onSelectLesson!(lesson.id)
              }}
            >
              <span class="menu-lesson-title">{lesson.title}</span>
              {lesson.hasNote === true && <span class="badge ok">已处理✓</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
