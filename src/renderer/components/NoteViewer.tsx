import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Note } from '../../shared/notes/schema'
import { projectNote, VIEW_IDS, type ViewId } from '../../shared/notes/views'
import { VIEW_LABELS } from '../labels'
import type { NoteAttachmentInfo } from '../../shared/bridge'

export interface NoteViewerProps {
  note: Note | null
  /** 2026-09-04: lesson keyframes/PPT images (data URLs). */
  attachments?: NoteAttachmentInfo[]
  /** Regenerate in flight (button busy state). */
  regenBusy?: boolean
  /** 2026-09-04: regenerate the note from stored transcripts/keyframes. */
  onRegenerate?: () => void
  onExport?: () => void
  /** Copy the markdown rendering to the clipboard (best-effort). */
  onCopy?: () => void
}

/** Four-view note reader (spec §5): one note JSON, four projections. */
export function NoteViewer({ note, onRegenerate, regenBusy = false, onExport, onCopy }: NoteViewerProps): JSX.Element {
  const [view, setView] = useState<ViewId>('detailed')
  return (
    <div class="note-viewer">
      <div class="note-toolbar">
        <nav
          class="note-tabs"
          role="tablist"
          onKeyDown={(e) => {
            // M3-2: roving-focus arrow navigation, matching the main tabs.
            const buttons = [...e.currentTarget.querySelectorAll('button')]
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
            if (i < 0) return
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault()
              const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]
              next?.focus()
              next?.click()
            }
          }}
        >
          {VIEW_IDS.map((id) => (
            <button
              key={id}
              class={id === view ? 'active' : ''}
              role="tab"
              aria-selected={id === view}
              tabIndex={id === view ? 0 : -1}
              onClick={() => setView(id)}
            >
              {VIEW_LABELS[id]}
            </button>
          ))}
        </nav>
        <div class="note-actions">
          {onRegenerate != null && note != null && (
            <button class="btn small" onClick={onRegenerate} disabled={regenBusy}>
              {regenBusy ? '生成中…' : '重新生成'}
            </button>
          )}
          {onCopy != null && note != null && (
            <button class="btn small" onClick={onCopy}>
              复制 Markdown
            </button>
          )}
          {onExport != null && (
            <button class="btn small" onClick={onExport}>
              导出 Markdown
            </button>
          )}
        </div>
      </div>
      <div class="note-body">
        {note == null ? (
          <p class="msg">尚无笔记 — 运行任务生成后自动显示</p>
        ) : (
          projectNote(note, view).map((section) => (
            <section key={section.heading} class="note-section">
              <h3>{section.heading}</h3>
              {section.lines.map((line, i) => (
                <p key={i} class={isTimestamped(line) ? 'ts' : ''}>
                  {line}
                </p>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function isTimestamped(line: string): boolean {
  return /^(\d{2}:\d{2})/.test(line)
}
