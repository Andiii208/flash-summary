import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { ChevronDown, ChevronRight } from 'lucide-preact'
import type { Note, TreeNode, QuizItem } from '../../shared/notes/schema'
import type { AttachmentLike, TimelineImage } from '../../shared/notes/evidence'
import { bindTimelineImages, resolveEvidenceGallery, quoteForEntry, formatTime, NEAREST_SECONDS } from '../../shared/notes/evidence'
import type { ViewBlock } from '../../shared/notes/views'
import { MdLite } from './MdLite'
import { Dialog } from '../ui/Dialog'

export interface NoteBlocksProps {
  blocks: ViewBlock[]
  attachments: AttachmentLike[]
}

/** Dispatch one structured block to its visual component (2026-09-04). */
export function NoteBlocks({ blocks, attachments }: NoteBlocksProps): JSX.Element {
  return (
    <>
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} attachments={attachments} />
      ))}
    </>
  )
}

function BlockRenderer({ block, attachments }: { block: ViewBlock; attachments: AttachmentLike[] }): JSX.Element {
  switch (block.block) {
    case 'paragraph':
      return <p class="note-para">{block.text}</p>
    case 'markdown':
      return <MdLite text={block.text} />
    case 'tree':
      return <TreeView node={block.node} />
    case 'timeline':
      return <TimelineCards entries={block.entries} attachments={attachments} />
    case 'concepts':
      return (
        <div class="concept-grid">
          {block.items.map((c) => (
            <div key={c.term} class="concept-card">
              <span class="concept-term">{c.term}</span>
              <p class="concept-def">{c.definition}</p>
              {c.refs.length > 0 && (
                <span class="concept-ref" title={c.refs[0]?.text}>
                  {formatTime(c.refs[0]?.at ?? 0)}
                </span>
              )}
            </div>
          ))}
        </div>
      )
    case 'formulas':
      return <FormulaList items={block.items} />
    case 'callout':
      return (
        <ul class={`callout-list ${block.tone === 'exam' ? 'exam' : 'gap'}`}>
          {block.items.map((item, i) => (
            <li key={i} class="callout-item">
              <span class="callout-tag">{block.tone === 'exam' ? '考点' : '待解决'}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )
    case 'steps':
      return (
        <ol class="step-list">
          {block.items.map((step, i) => (
            <li key={i} class="step-item">
              <span class="step-index">{i + 1}</span>
              <div class="step-body">
                <p class="step-content">{step.content}</p>
                {step.explanation !== '' && <p class="step-explain">{step.explanation}</p>}
              </div>
            </li>
          ))}
        </ol>
      )
    case 'quiz':
      return <QuizCards items={block.items} />
  }
}

/** Self-quiz flashcards (roadmap 2.1): question first, click to flip the
 *  answer over — zero dependencies, plain Preact state. */
function QuizCards({ items }: { items: QuizItem[] }): JSX.Element {
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set())
  const toggle = (index: number): void => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }
  return (
    <div class="quiz-list" data-testid="quiz-cards">
      {items.map((item, i) => {
        const open = revealed.has(i)
        const anchor = item.source === 'concept' ? `概念 · ${item.term ?? ''}` : '考点'
        return (
          <article key={i} class={`quiz-card${open ? ' revealed' : ''}`}>
            <span class="quiz-tag">{anchor}</span>
            <button class="quiz-flip" onClick={() => toggle(i)} aria-expanded={open}>
              <p class="quiz-question">{item.question}</p>
              {open ? <p class="quiz-answer">{item.answer}</p> : <span class="quiz-hint">点击翻面看答案</span>}
            </button>
          </article>
        )
      })}
    </div>
  )
}

/** Collapsible indented tree (reading view; the interactive map is MindMap). */
function TreeView({ node }: { node: TreeNode }): JSX.Element {
  return (
    <div class="tree-view" role="tree">
      <TreeNodeRows node={node} depth={0} />
    </div>
  )
}

function TreeNodeRows({ node, depth }: { node: TreeNode; depth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children.length > 0
  return (
    <div class="tree-row-wrap">
      <div class={`tree-row depth-${depth}`} style={`margin-left:${depth * 16}px`}>
        {hasChildren ? (
          <button class="tree-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <span class="tree-caret">{open ? <ChevronDown size={11} strokeWidth={1.75} /> : <ChevronRight size={11} strokeWidth={1.75} />}</span>
            <span class="tree-title" role={depth === 0 ? 'treeitem' : undefined}>
              {node.title}
            </span>
            {!open && <span class="tree-count">{node.children.length}</span>}
          </button>
        ) : (
          <span class="tree-leaf" style={`margin-left:${depth === 0 ? 22 : 22}px`}>
            <span class="tree-dot" />
            {node.title}
          </span>
        )}
      </div>
      {open && node.children.map((child, i) => <TreeNodeRows key={i} node={child} depth={depth + 1} />)}
    </div>
  )
}

/** Timeline as image-annotated cards (the heart of the detailed view).
 *  Clicking the mm:ss stamp expands every transcript quote of the entry
 *  (the collapsed card shows only the closest one). */
function TimelineCards({ entries, attachments }: { entries: Note['timeline']; attachments: AttachmentLike[] }): JSX.Element {
  const [zoom, setZoom] = useState<TimelineImage | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const toggleRefs = (index: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }
  return (
    <div class="timeline-cards" data-testid="timeline-cards">
      {entries.map((entry, i) => {
        const images = bindTimelineImages(entry, attachments)
        const quote = quoteForEntry(entry)
        const showAllRefs = expanded.has(i)
        const refs = showAllRefs ? entry.refs : quote != null ? [quote] : []
        return (
          <article key={i} class="timeline-card">
            <header class="timeline-head">
              <button
                class={`timeline-stamp${showAllRefs ? ' active' : ''}`}
                onClick={() => toggleRefs(i)}
                title={entry.refs.length > 1 ? '点击展开/收起全部转写引文' : undefined}
                aria-expanded={entry.refs.length > 1 ? showAllRefs : undefined}
              >
                {formatTime(entry.at)}
              </button>
              <h4 class="timeline-title">{entry.title}</h4>
            </header>
            <p class="timeline-detail">{entry.detail}</p>
            {refs.map((ref, j) => (
              <blockquote key={j} class={`timeline-quote${j === 0 && !showAllRefs ? ' best' : ''}`}>
                「{ref.text}」<span class="quote-at">{formatTime(ref.at)}</span>
              </blockquote>
            ))}
            {entry.refs.length > 1 && (
              <button class="refs-toggle" onClick={() => toggleRefs(i)}>
                {showAllRefs ? `收起（${entry.refs.length} 条）` : `展开全部 ${entry.refs.length} 条引文`}
              </button>
            )}
            {images.length > 0 && (
              <div class="timeline-images">
                {images.map((img) => (
                  <button key={img.ref} class="timeline-thumb" title={img.ref} onClick={() => setZoom(img)}>
                    <img src={img.dataUrl} alt={`${entry.title}的课堂画面`} loading="lazy" />
                    <span class={`thumb-origin ${img.origin}`}>{img.origin === 'evidence' ? '引用' : '就近'}</span>
                  </button>
                ))}
              </div>
            )}
          </article>
        )
      })}
      <Dialog open={zoom != null} title={zoom?.ref ?? ''} confirmLabel="关闭" onConfirm={() => setZoom(null)} onCancel={() => setZoom(null)}>
        {zoom != null && <img class="zoom-image" src={zoom.dataUrl} alt={zoom.ref} />}
      </Dialog>
    </div>
  )
}

/** Formulas / code / operations with per-kind styling. */
function FormulaList({ items }: { items: Note['formulasAndSteps'] }): JSX.Element {
  const labels = { formula: '公式', code: '代码', operation: '操作' } as const
  return (
    <div class="formula-list">
      {items.map((item, i) => (
        <div key={i} class={`formula-item kind-${item.kind}`}>
          <span class="formula-tag">{labels[item.kind]}</span>
          {item.kind === 'code' ? (
            <pre class="formula-code">
              <code>{item.content}</code>
            </pre>
          ) : (
            <p class="formula-content">{item.content}</p>
          )}
          {item.explanation !== '' && <p class="formula-explain">{item.explanation}</p>}
        </div>
      ))}
    </div>
  )
}

/** The evidence gallery section (cited first, then remaining keyframes). */
export function EvidenceGallery({ note, attachments }: { note: Note; attachments: AttachmentLike[] }): JSX.Element {
  const [zoom, setZoom] = useState<TimelineImage | null>(null)
  const gallery = resolveEvidenceGallery(note, attachments)
  if (gallery.length === 0) return <p class="msg">本课时尚无可用画面素材</p>
  return (
    <div class="evidence-gallery" data-testid="evidence-gallery">
      {gallery.map((img) => (
        <figure key={img.ref} class="evidence-fig">
          {/* C3: gallery figures zoom like the timeline thumbs. */}
          <button class="evidence-zoom-btn" title={`放大 ${img.ref}`} onClick={() => setZoom(img)}>
            <img src={img.dataUrl} alt={`课堂画面 ${img.ref}`} loading="lazy" />
          </button>
          <figcaption>
            <span class="evidence-ref">{img.ref}</span>
            <span class={`thumb-origin ${img.origin}`}>{img.origin === 'evidence' ? '笔记引用' : '时间线画面'}</span>
          </figcaption>
        </figure>
      ))}
      <Dialog open={zoom != null} title={zoom?.ref ?? ''} confirmLabel="关闭" onConfirm={() => setZoom(null)} onCancel={() => setZoom(null)}>
        {zoom != null && <img class="zoom-image" src={zoom.dataUrl} alt={zoom.ref} />}
      </Dialog>
    </div>
  )
}

export { NEAREST_SECONDS }
