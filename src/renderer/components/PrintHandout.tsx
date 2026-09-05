import type { JSX } from 'preact'
import type { ConceptLink, Note, TreeNode } from '../../shared/notes/schema'
import type { AttachmentLike, TimelineImage } from '../../shared/notes/evidence'
import { bindTimelineImages, quoteForEntry, resolveEvidenceGallery, formatTime } from '../../shared/notes/evidence'
import { computeMindMapLayout, sublineFirstBaseline, sublineLinesOf, titleBaseline } from '../../shared/notes/mindmap-layout'
import { MdLite } from './MdLite'

export interface PrintHandoutData {
  note: Note
  attachments: AttachmentLike[]
  courseName: string
  lessonTitle: string
  teacher?: string | null
  courTimes?: string | null
  classroom?: string | null
  generatedAt: string
}

/** Static full-lesson PDF handout (2026-09-04): cover → mind map → body → gallery. */
export function PrintHandout(data: PrintHandoutData): JSX.Element {
  const { note, attachments, courseName, lessonTitle, teacher, courTimes, classroom, generatedAt } = data
  const meta = [courseName, teacher ?? '', [courTimes, classroom].filter((s) => s != null && s !== '').join(' · ')]
    .filter((s) => s !== '')
    .join(' ｜ ')
  return (
    <div class="ph-doc" id="print-root-inner">
      <section class="ph-cover">
        <div class="ph-kicker">SEU SUMMARY · 课堂讲义</div>
        <h1>{lessonTitle}</h1>
        <div class="ph-meta">
          {meta}
          <br />
          生成时间：{generatedAt}
        </div>
        <div class="ph-cover-summary">
          <MdLite text={firstParagraph(note.overview)} />
        </div>
      </section>

      <section class="ph-section ph-mindmap-page">
        <h2>知识导图</h2>
        <StaticMindMap tree={note.knowledgeTree} links={note.conceptLinks} />
      </section>

      <section class="ph-section">
        <h2>课程概览</h2>
        <MdLite text={note.overview} />
      </section>

      <section class="ph-section">
        <h2>时间线</h2>
        {note.timeline.map((entry, i) => (
          <PrintTimelineCard key={i} entry={entry} attachments={attachments} />
        ))}
      </section>

      {note.concepts.length > 0 && (
        <section class="ph-section">
          <h2>概念与定义</h2>
          <div class="ph-concept-grid">
            {note.concepts.map((c) => (
              <div key={c.term} class="ph-concept">
                <span class="ph-concept-term">{c.term}</span>
                <span class="ph-concept-def">{c.definition}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {note.formulasAndSteps.length > 0 && (
        <section class="ph-section">
          <h2>公式、代码与操作步骤</h2>
          {note.formulasAndSteps.map((item, i) => (
            <div key={i} class={`ph-formula kind-${item.kind}`}>
              <span class="ph-formula-tag">{labelOf(item.kind)}</span>
              {item.kind === 'code' ? (
                <pre>
                  <code>{item.content}</code>
                </pre>
              ) : (
                <span class="ph-formula-content">{item.content}</span>
              )}
              {item.explanation !== '' && <p class="ph-formula-explain">{item.explanation}</p>}
            </div>
          ))}
        </section>
      )}

      <section class="ph-section">
        <h2>方法论</h2>
        <MdLite text={note.methodology} />
      </section>

      {(note.examCues.length > 0 || note.questionsAndGaps.length > 0) && (
        <section class="ph-section">
          <h2>考试与作业提示 · 疑问与缺口</h2>
          {note.examCues.map((cue, i) => (
            <div key={`e${i}`} class="ph-callout exam">
              <span class="ph-callout-tag">考点</span>
              {cue}
            </div>
          ))}
          {note.questionsAndGaps.map((gap, i) => (
            <div key={`g${i}`} class="ph-callout gap">
              <span class="ph-callout-tag">待解决</span>
              {gap}
            </div>
          ))}
        </section>
      )}

      {note.quiz.length > 0 && (
        <section class="ph-section">
          <h2>自测题</h2>
          {note.quiz.map((item, i) => (
            <div key={i} class="ph-quiz-row">
              <div class="ph-quiz-q">
                <span class="ph-quiz-num">{i + 1}</span>
                <span class="ph-quiz-tag">{item.source === 'concept' ? `概念 · ${item.term ?? ''}` : '考点'}</span>
                <span class="ph-quiz-question">{item.question}</span>
              </div>
              <div class="ph-quiz-a">{item.answer}</div>
            </div>
          ))}
        </section>
      )}

      <section class="ph-section">
        <h2>课堂画面</h2>
        <div class="ph-gallery">
          {resolveEvidenceGallery(note, attachments).map((img) => (
            <figure key={img.ref}>
              <img src={img.dataUrl} alt={`课堂画面 ${img.ref}`} />
              <figcaption>{img.ref}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <div class="ph-footer">SEU Summary 生成 · 依据课堂转写与关键帧画面整理</div>
    </div>
  )
}

/** The cover uses only the opening paragraph, not the full markdown. */
function firstParagraph(text: string): string {
  const first = text.split(/\n\s*\n/)[0] ?? text
  return first.replace(/^#+\s*/m, '').trim()
}

function PrintTimelineCard({ entry, attachments }: { entry: Note['timeline'][number]; attachments: AttachmentLike[] }): JSX.Element {
  const images: TimelineImage[] = bindTimelineImages(entry, attachments)
  const quote = quoteForEntry(entry)
  return (
    <article class="ph-timeline-card">
      <div class="ph-timeline-head">
        <span class="ph-timeline-stamp">{formatTime(entry.at)}</span>
        <h3>{entry.title}</h3>
      </div>
      <p class="ph-timeline-detail">{entry.detail}</p>
      {quote != null && (
        <blockquote class="ph-timeline-quote">
          「{quote.text}」（{formatTime(quote.at)}）
        </blockquote>
      )}
      {images.length > 0 && (
        <div class="ph-timeline-images">
          {images.map((img) => (
            <img key={img.ref} src={img.dataUrl} alt={`${entry.title}的课堂画面`} />
          ))}
        </div>
      )}
    </article>
  )
}

/** Non-interactive mind map (always fully expanded) sized for one A4 page. */
function StaticMindMap({ tree, links = [] }: { tree: TreeNode; links?: ConceptLink[] }): JSX.Element {
  // M2.1/M3.1: the handout opts into concept-term sub-lines and cross-links
  // (决策点 D4 — the shared geometry renders both); screen popover handles the rest.
  const layout = computeMindMapLayout(tree, new Set(), { showTerms: true, links })
  const maxPageWidth = 730
  const maxPageHeight = 900
  // 批E: multi-line nodes grow tall — scale to fit both page dimensions.
  const scale = Math.min(maxPageWidth / layout.width, maxPageHeight / layout.height, 1)
  return (
    <svg
      width={Math.round(layout.width * scale)}
      height={Math.round(layout.height * scale)}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`知识导图：${tree.title}`}
    >
      {layout.edges.map((edge) => (
        <path key={`${edge.from}-${edge.to}`} d={edge.d} fill="none" stroke="#b9c4ea" stroke-width={1.8} />
      ))}
      {/* M3.1: dashed cross-links, visually distinct from hierarchical edges. */}
      {layout.links.map((link) => (
        <g key={`ph-link-${link.fromId}-${link.toId}`}>
          <path d={link.d} fill="none" stroke="#9aa6d8" stroke-width={1.4} stroke-dasharray="5 4" />
          {link.label !== '' && (
            <g transform={`translate(${link.lx}, ${link.ly})`}>
              <rect x={-(link.label.length * 6.5 + 10) / 2} y={-9} width={link.label.length * 6.5 + 10} height={18} rx={9} fill="#f4f5fa" stroke="#dfe3ee" />
              <text text-anchor="middle" y={3.5} font-size={10} fill="#6a7286">
                {link.label}
              </text>
            </g>
          )}
        </g>
      ))}
      {layout.nodes.map((node) => (
        <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
          <rect
            width={node.width}
            height={node.height}
            rx={8}
            fill={node.depth === 0 ? '#e0e6ff' : '#f4f5fa'}
            stroke={node.depth === 0 ? 'none' : '#e3e6ee'}
          />
          {/* 批E: wrapped tspans — titles print in full, never truncated. */}
          <text x={12} y={titleBaseline(node)} font-size={13} fill="#1f2430" font-weight={node.depth === 0 ? 700 : 400}>
            {node.lines.map((line, i) => (
              <tspan key={i} x={12} dy={i === 0 ? 0 : 18}>
                {line}
              </tspan>
            ))}
          </text>
          {/* M2.1: anchored concept terms as a muted sub-line. */}
          {node.subline !== '' && (
            <text x={12} y={sublineFirstBaseline(node)} font-size={11} fill="#6a7286">
              {sublineLinesOf(node).map((line, i) => (
                <tspan key={i} x={12} dy={i === 0 ? 0 : 14}>
                  {line}
                </tspan>
              ))}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

function labelOf(kind: 'formula' | 'code' | 'operation'): string {
  return kind === 'formula' ? '公式' : kind === 'code' ? '代码' : '操作'
}
