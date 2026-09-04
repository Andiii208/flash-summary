import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Note } from '../../shared/notes/schema'
import { evidenceHitRate, type AttachmentLike } from '../../shared/notes/evidence'
import { projectNoteBlocks, VIEW_IDS, type ViewId } from '../../shared/notes/views'
import { VIEW_LABELS } from '../labels'
import type { NoteAttachmentInfo } from '../../shared/bridge'
import { NoteBlocks, EvidenceGallery } from './NoteBlocks'
import { MindMap } from './MindMap'

export interface NoteViewerProps {
  note: Note | null
  /** 2026-09-04: lesson keyframes/PPT images (data URLs). */
  attachments?: NoteAttachmentInfo[]
  /** Regenerate in flight (button busy state). */
  regenBusy?: boolean
  /** 2026-09-04: regenerate the note from stored transcripts/keyframes. */
  onRegenerate?: () => void
  /** 2026-09-04: export the full-lesson PDF handout. */
  pdfBusy?: boolean
  onExportPdf?: () => void
  onExport?: () => void
  /** 2026-09-04 roadmap 2.2: export Anki TSV decks (concepts + quiz). */
  onExportAnki?: () => void
  /** Copy the markdown rendering to the clipboard (best-effort). */
  onCopy?: () => void
}

/** Five-view note reader: one note JSON, five projections (2026-09-04). */
export function NoteViewer({
  note,
  attachments = [],
  regenBusy = false,
  onRegenerate,
  pdfBusy = false,
  onExportPdf,
  onExport,
  onExportAnki,
  onCopy
}: NoteViewerProps): JSX.Element {
  const [view, setView] = useState<ViewId>('detailed')
  // Citation quality signal (roadmap 1.3): share of cited evidence refs that
  // resolve to real attachments; hidden when the note cites none.
  const hitRate = note != null ? evidenceHitRate(note, attachments) : null
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
          {hitRate != null && hitRate.total > 0 && (
            <span class="badge" title={`时间线证据引用精确命中附件 ${hitRate.hits}/${hitRate.total}`}>
              引用命中 {hitRate.hits}/{hitRate.total}
            </span>
          )}
          {onExportPdf != null && (
            <button class="btn small primary" onClick={onExportPdf} disabled={pdfBusy}>
              {pdfBusy ? '生成 PDF 中…' : '导出 PDF 讲义'}
            </button>
          )}
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
          {onExportAnki != null && note != null && (
            <button class="btn small" onClick={onExportAnki}>
              导出 Anki
            </button>
          )}
          {onExport != null && note != null && (
            <button class="btn small" onClick={onExport}>
              导出 Markdown
            </button>
          )}
        </div>
      </div>
      <div class="note-body">
        {note == null ? (
          <p class="msg">尚无笔记 — 运行任务生成后自动显示</p>
        ) : view === 'mindmap' ? (
          <MindMap tree={note.knowledgeTree} />
        ) : (
          projectNoteBlocks(note, view).map((section) => (
            <section key={section.heading} class="note-section">
              <h3>{section.heading}</h3>
              <NoteBlocks blocks={section.blocks} attachments={attachments as AttachmentLike[]} />
            </section>
          ))
        )}
        {note != null && view === 'detailed' && (
          <section class="note-section">
            <h3>课堂画面</h3>
            <EvidenceGallery note={note} attachments={attachments as AttachmentLike[]} />
          </section>
        )}
      </div>
    </div>
  )
}
