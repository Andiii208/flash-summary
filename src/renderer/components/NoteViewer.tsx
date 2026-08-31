import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Note } from '../../shared/notes/schema'
import { projectNote, VIEW_IDS, type ViewId } from '../../shared/notes/views'
import { VIEW_LABELS } from '../labels'

export interface NoteViewerProps {
  note: Note | null
  onExport?: () => void
}

/** Four-view note reader (spec §5): one note JSON, four projections. */
export function NoteViewer({ note, onExport }: NoteViewerProps): JSX.Element {
  const [view, setView] = useState<ViewId>('detailed')
  return (
    <div class="note-viewer">
      <div class="note-toolbar">
        <nav class="note-tabs" role="tablist">
          {VIEW_IDS.map((id) => (
            <button key={id} class={id === view ? 'active' : ''} role="tab" aria-selected={id === view} onClick={() => setView(id)}>
              {VIEW_LABELS[id]}
            </button>
          ))}
        </nav>
        {onExport != null && (
          <button class="btn small" onClick={onExport}>
            导出 Markdown
          </button>
        )}
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
