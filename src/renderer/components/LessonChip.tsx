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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const switchable = (lessons?.length ?? 0) > 0 && onSelectLesson != null

  // 健康巡查 2026-09-12 批6: role="menu" promised keyboard support it did
  // not have — Escape closes (focus back on the trigger) and ArrowUp/Down
  // walk the menu items.
  const onRootKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && open) {
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (!open || !switchable) return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const currentIdx = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1
    const next =
      e.key === 'ArrowDown'
        ? items[Math.min(currentIdx + 1, items.length - 1)] ?? items[0]!
        : items[Math.max(currentIdx - 1, 0)] ?? items[0]!
    next.focus()
  }

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
    <span class="lesson-chip" ref={rootRef} onKeyDown={onRootKeyDown}>
      {/* 批5: 不可切换时降级为纯文本胶囊——按钮外观却无响应是死端。 */}
      {switchable ? (
        <button
          class="lesson-chip-btn"
          ref={triggerRef}
          title={`${courseName} · ${lessonTitle}（点击切换本课课时）`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span class="lesson-chip-course">{courseName}</span>
          <span class="lesson-chip-dot" aria-hidden="true">
            ·
          </span>
          <span class="lesson-chip-lesson">{lessonTitle}</span>
          <ChevronDown size={12} strokeWidth={1.75} class={`chip-caret${open ? ' open' : ''}`} />
        </button>
      ) : (
        <span class="lesson-chip-btn passive" title={`${courseName} · ${lessonTitle}`}>
          <span class="lesson-chip-course">{courseName}</span>
          <span class="lesson-chip-dot" aria-hidden="true">
            ·
          </span>
          <span class="lesson-chip-lesson">{lessonTitle}</span>
        </span>
      )}
      {open && switchable && (
        <div class="lesson-chip-menu" role="menu" ref={menuRef}>
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
