import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-preact'
import type { Note, TreeNode, QuizItem, Chapter, Quote } from '../../shared/notes/schema'
import type { TimelineImage, AttachmentManifestEntry } from '../../shared/notes/evidence'
import { allocateTimelineImagesLazy, resolveEvidenceGalleryLazy, quoteForEntry } from '../../shared/notes/evidence'
import { groupTimelineByChapters } from '../../shared/notes/chapters'
import { foldNearDuplicateFrames } from '../../shared/notes/evidence-groups'
import { groupFramesByChapters } from '../../shared/notes/frame-groups'
import { formatTime } from '../../shared/notes/format'
import type { NoteAttachmentInfo } from '../../shared/bridge'
import type { ViewBlock } from '../../shared/notes/views'
import { MdLite } from './MdLite'
import { InlineText } from './InlineText'
import { CodeBlock } from './CodeBlock'
import { Dialog } from '../ui/Dialog'

export interface NoteBlocksProps {
  blocks: ViewBlock[]
  /** F4 (review): lazy attachment lookup — undefined means still loading. */
  getAttachment?: (ref: string) => NoteAttachmentInfo | null | undefined
  manifest: AttachmentManifestEntry[]
  /** Bumped per resolved attachment so the tree re-renders. */
  version: number
  /** 批 D (plan 2026-09-19): 跳原片（at 秒）；SEU 源/PDF 投影不传。 */
  onOpenSource?: (at: number) => void
}

/** Dispatch one structured block to its visual component (2026-09-04). */
export function NoteBlocks({ blocks, getAttachment, manifest, version, onOpenSource }: NoteBlocksProps): JSX.Element {
  return (
    <>
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} getAttachment={getAttachment} manifest={manifest} version={version} onOpenSource={onOpenSource} />
      ))}
    </>
  )
}

function BlockRenderer({ block, getAttachment, manifest, version, onOpenSource }: { block: ViewBlock; getAttachment?: (ref: string) => NoteAttachmentInfo | null | undefined; manifest: AttachmentManifestEntry[]; version: number; onOpenSource?: (at: number) => void }): JSX.Element {
  switch (block.block) {
    case 'paragraph':
      return <p class="note-para">{block.text}</p>
    case 'markdown':
      return <MdLite text={block.text} />
    case 'tree':
      return <TreeView node={block.node} />
    case 'timeline':
      return <TimelineCards entries={block.entries} chapters={block.chapters} getAttachment={getAttachment} manifest={manifest} version={version} onOpenSource={onOpenSource} />
    case 'concepts':
      return (
        <div class="concept-grid">
          {block.items.map((c) => (
            <div key={c.term} class="concept-card" data-concept-term={c.term}>
              <span class="concept-term">{c.term}</span>
              {/* 批4: 定义里的 ** 加粗照模型本意渲染（与 PDF 同待遇） */}
              <p class="concept-def">
                <InlineText text={c.definition} />
              </p>
              {/* 批2: 具体例子（讲者没给例子就没有这一行）。必须走 InlineText——
                  AGENTS 硬规定：笔记字段的用户可见文本一律经 MdLite/InlineText。 */}
              {c.example != null && c.example.trim() !== '' && (
                <p class="concept-example">
                  <span class="concept-example-tag">例</span>
                  <InlineText text={c.example} />
                </p>
              )}
              {c.refs.length > 0 && (
                <button
                  class="concept-ref"
                  title="定位到时间线对应条目"
                  onClick={() => {
                    // 批6: the timestamp was a dead end before — now it jumps to
                    // the matching timeline card (same view, scroll only).
                    const target = document.querySelector(`[data-timeline-at="${c.refs[0]?.at ?? 0}"]`)
                    if (target != null && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' })
                  }}
                >
                  {formatTime(c.refs[0]?.at ?? 0)}
                </button>
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
              <span>
                <InlineText text={item} />
              </span>
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
                {/* 批4: 步骤正文可能含「1. **xx**」式 markdown——解析渲染 */}
                <div class="step-content">
                  <InlineText text={step.content} />
                </div>
                {step.explanation !== '' && (
                  <p class="step-explain">
                    <InlineText text={step.explanation} />
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )
    case 'quiz':
      return <QuizCards items={block.items} />
    case 'quotes':
      return <QuoteList items={block.items} />
  }
}

/** Self-quiz flashcards (roadmap 2.1): question first, click to flip the
 *  answer over — zero dependencies, plain Preact state.
 *  M2.2: exported for reuse inside the mind map node popover.
 *  批6: reveal state keys on the QUESTION, not the array index — a
 *  regenerated note must not inherit «open» onto different content. */
export function QuizCards({ items }: { items: QuizItem[] }): JSX.Element {
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string): void => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  return (
    <div class="quiz-list" data-testid="quiz-cards">
      {items.map((item) => {
        const key = item.question
        const open = revealed.has(key)
        const anchor = item.source === 'concept' ? `概念 · ${item.term ?? ''}` : '考点'
        return (
          <article key={key} class={`quiz-card${open ? ' revealed' : ''}`}>
            <span class="quiz-tag">{anchor}</span>
            <button class="quiz-flip" onClick={() => toggle(key)} aria-expanded={open}>
              <p class="quiz-question">
                <InlineText text={item.question} />
              </p>
              {open ? (
                <>
                  <p class="quiz-answer">
                    <InlineText text={item.answer} />
                  </p>
                  <span class="quiz-hint quiz-collapse-hint">再点一次收起</span>
                </>
              ) : (
                <span class="quiz-hint">点击翻面看答案</span>
              )}
            </button>
          </article>
        )
      })}
    </div>
  )
}

/** B2 (plan 2026-09-19): 金句 pull-quote——讲者原话，时间徽章 + 引文。
 * 视觉纪律：复用 .timeline-quote 的黄铜引规格局，不新增装饰元素。 */
function QuoteList({ items }: { items: Quote[] }): JSX.Element {
  return (
    <div class="quote-list" data-testid="quote-list">
      {items.map((item) => (
        <blockquote key={`${item.at}:${item.text.slice(0, 12)}`} class="quote-pull">
          <span class="quote-pull-at">{formatTime(item.at)}</span>
          <p class="quote-pull-text">「{item.text}」</p>
        </blockquote>
      ))}
    </div>
  )
}

/** Collapsible indented tree (reading view; the interactive map is MindMap).
 *  批3: 全部展开/收起——对齐 MindMap 的深度控制能力；通过 key 重挂载让
 *  每行的本地 open 状态以新默认值重建（比逐行下发命令简单一个量级）。 */
function TreeView({ node }: { node: TreeNode }): JSX.Element {
  const [override, setOverride] = useState<{ open: boolean; seq: number } | null>(null)
  return (
    <div class="tree-view" role="tree">
      <div class="tree-view-tools">
        {/* 批6 (T39): 与侧栏、导图统一为「由少到多」：全部收起 → 全部展开。 */}
        <button class="btn small ghost" onClick={() => setOverride({ open: false, seq: (override?.seq ?? 0) + 1 })}>
          全部收起
        </button>
        <button class="btn small ghost" onClick={() => setOverride({ open: true, seq: (override?.seq ?? 0) + 1 })}>
          全部展开
        </button>
      </div>
      <TreeNodeRows key={override?.seq ?? 0} node={node} depth={0} defaultOpen={override?.open} />
    </div>
  )
}

function TreeNodeRows({ node, depth, defaultOpen }: { node: TreeNode; depth: number; defaultOpen?: boolean }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen ?? depth < 2)
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
      {open && node.children.map((child, i) => <TreeNodeRows key={i} node={child} depth={depth + 1} defaultOpen={defaultOpen} />)}
    </div>
  )
}

/** Timeline as image-annotated cards (the heart of the detailed view).
 *  Clicking the mm:ss stamp expands every transcript quote of the entry
 *  (the collapsed card shows only the closest one).
 *  批 A5 (plan 2026-09-19): 配图改为整份时间线的贪心一对一分配——稀缺帧优先给
 *  离得最近的那条，18 帧 18 条全部配上（旧 90s 筛子实测只有 28%）。 */
function TimelineCards({ entries, chapters, getAttachment, manifest, version: versionForRerender, onOpenSource }: { entries: Note['timeline']; chapters?: Chapter[]; getAttachment?: (ref: string) => NoteAttachmentInfo | null | undefined; manifest: AttachmentManifestEntry[]; version: number; onOpenSource?: (at: number) => void }): JSX.Element {
  void versionForRerender
  const [zoom, setZoom] = useState<{ img: TimelineImage; entryTitle: string; at: number } | null>(null)
  // 批6: expansion keys on content (at+title), not the index — regenerating
  // the note must not leave «open» stuck onto different entries.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const entryKey = (entry: Note['timeline'][number]): string => `${entry.at}:${entry.title}`
  const toggleRefs = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const allocated = allocateTimelineImagesLazy(entries, getAttachment ?? (() => null), manifest)
  const frameAt = (ref: string): number | null => manifest.find((m) => m.ref === ref)?.at ?? null
  // B1: 有章节时按章分组（章头 + 组内卡片）；无章节/空章节 → 平铺（旧笔记渲染逐字节不变）。
  type Item = { kind: 'chapter'; chapter: Chapter } | { kind: 'entry'; entry: Note['timeline'][number]; index: number }
  const items: Item[] = []
  if (chapters != null && chapters.length > 0) {
    for (const group of groupTimelineByChapters(entries, chapters)) {
      if (group.chapter != null) items.push({ kind: 'chapter', chapter: group.chapter })
      for (const e of group.entries) items.push({ kind: 'entry', entry: e, index: entries.indexOf(e) })
    }
  } else {
    entries.forEach((entry, index) => items.push({ kind: 'entry', entry, index }))
  }
  return (
    <div class="timeline-cards" data-testid="timeline-cards">
      {items.map((item, i) => {
        if (item.kind === 'chapter') {
          return (
            <div class="timeline-chapter" key={`chapter-${item.chapter.at}-${i}`} data-chapter-at={item.chapter.at}>
              <span class="timeline-chapter-at">{formatTime(item.chapter.at)}</span>
              <h4 class="timeline-chapter-title">{item.chapter.title}</h4>
              <p class="timeline-chapter-summary">{item.chapter.summary}</p>
            </div>
          )
        }
        const entry = item.entry
        const images = allocated[item.index] ?? []
        const quote = quoteForEntry(entry)
        const key = entryKey(entry)
        const showAllRefs = expanded.has(key)
        const refs = showAllRefs ? entry.refs : quote != null ? [quote] : []
        // C4 (plan 2026-09-19): 有图卡片改图文并排（按条目奇偶左右交替＋视觉节奏）；
        // 无图卡片的重点摘引升级为“大引文”（视觉补位）。
        const side = images.length > 0
        const alt = item.index % 2 === 1
        return (
          <article key={key} class={`timeline-card${side ? ' has-images' : ''}${alt ? ' alt' : ''}`} data-timeline-at={entry.at}>
            <div class="timeline-body">
            <header class="timeline-head">
              {/* 批6: a single-ref stamp is a label, not a button — the toggle
                  only exists when there is more than one quote to expand. */}
              {entry.refs.length > 1 ? (
                <button class={`timeline-stamp${showAllRefs ? ' active' : ''}`} onClick={() => toggleRefs(key)} title="点击展开/收起全部转写引文" aria-expanded={showAllRefs}>
                  {formatTime(entry.at)}
                </button>
              ) : (
                <span class="timeline-stamp">{formatTime(entry.at)}</span>
              )}
              {onOpenSource != null && (
              <button class="timeline-open-src" title={`在浏览器打开原片 ${formatTime(entry.at)}`} onClick={() => onOpenSource(entry.at)}>
              <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
              <span class="timeline-open-src-label">原片</span>
              </button>
              )}
<h4 class="timeline-title">{entry.title}</h4>
            </header>
            <p class="timeline-detail">
              <InlineText text={entry.detail} />
            </p>
            {refs.map((ref, j) => (
              <blockquote key={j} class={`timeline-quote${j === 0 && !showAllRefs ? ' best' : ''}${!side && j === 0 && !showAllRefs ? ' hero' : ''}`}>
                「{ref.text}」<span class="quote-at">{formatTime(ref.at)}</span>
              </blockquote>
            ))}
            {entry.refs.length > 1 && (
              <button class="refs-toggle" onClick={() => toggleRefs(key)}>
                {showAllRefs ? `收起（${entry.refs.length} 条）` : `展开全部 ${entry.refs.length} 条引文`}
              </button>
            )}
            </div>
            {side && (
              <div class="timeline-side">
                {images.map((img) => (
                  <button
                    key={img.ref}
                    class="timeline-thumb"
                    title={`放大查看（${img.origin === 'evidence' ? '笔记引用的画面' : '临近关键帧'}${img.origin === 'nearest' && frameAt(img.ref) != null ? ` · 画面在 ${formatTime(frameAt(img.ref) as number)}` : ''}）`}
                    onClick={() => setZoom({ img, entryTitle: entry.title, at: entry.at })}
                  >
                    <img src={img.dataUrl} alt={`${entry.title}的课堂画面`} loading="lazy" />
                    <span class={`thumb-origin ${img.origin}`}>{img.origin === 'evidence' ? '引用画面' : '临近画面'}</span>
                  </button>
                ))}
              </div>
            )}
          </article>
        )
      })}
      {/* 批6: human title + single close action + backdrop click (view dialog). */}
      <Dialog
        open={zoom != null}
        kind="view"
        title={zoom != null ? `${zoom.entryTitle} · ${formatTime(zoom.at)}` : ''}
        confirmLabel="关闭"
        extraActions={
          onOpenSource != null && zoom != null ? (
            <button
              class="btn small"
              onClick={() => {
                const at = zoom.at
                setZoom(null)
                onOpenSource(at)
              }}
            >
              {`跳到原片 ${formatTime(zoom.at)}`}
            </button>
          ) : null
        }
        onConfirm={() => setZoom(null)}
        onCancel={() => setZoom(null)}
      >
        {zoom != null && <img class="zoom-image" src={zoom.img.dataUrl} alt={zoom.entryTitle} />}
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
            /* 批4 D8=B: 共享 CodeBlock（≥3 行才编号、行号走 CSS 计数器不进文本） */
            <CodeBlock code={item.content} class="formula-code" />
          ) : (
            /* 批4: 公式/操作正文走 MdLite——操作多步渲染成有序列表而非一长行 */
            <div class="formula-content">
              <MdLite text={item.content} />
            </div>
          )}
          {item.explanation !== '' && (
            <p class="formula-explain">
              <InlineText text={item.explanation} />
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

/** The evidence gallery section (cited first, then remaining keyframes). */
export function EvidenceGallery({ note, getAttachment, manifest, version: versionForRerender, onOpenSource }: { note: Note; getAttachment?: (ref: string) => NoteAttachmentInfo | null | undefined; manifest: AttachmentManifestEntry[]; version: number; onOpenSource?: (at: number) => void }): JSX.Element {
  void versionForRerender
  const [zoom, setZoom] = useState<TimelineImage | null>(null)
  // A6: 折叠组展开态（按代表帧 ref 记）。
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set())
  const gallery = resolveEvidenceGalleryLazy(note, getAttachment ?? (() => null), manifest)
  // A3 (plan 2026-09-19): 空态不再是一句灰字——说原因（风控/无画面变化）与出路（重试导入）。
  if (gallery.length === 0)
    return (
      <p class="msg">本课时没有可用画面素材——B 站视频流可能被平台风控拦截，或整段没有画面变化；重新运行任务可能恢复。</p>
    )
  const toggleGroup = (ref: string): void => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }
  // 单组渲染（A6 折叠逻辑复用）。
  const renderGroup = (group: ReturnType<typeof foldNearDuplicateFrames>[number]): JSX.Element => {
    const rep = group.representative
    const folded = group.members.length > 1
    const open = openGroups.has(rep.ref)
    return (
      <figure key={rep.ref} class="evidence-fig" data-testid="gallery-group">
        <button class="evidence-zoom-btn" title={`放大查看（${rep.origin === 'evidence' ? '笔记引用的画面' : '时间线画面'}）`} onClick={() => setZoom(rep)}>
          <img src={rep.dataUrl} alt={`课堂画面 ${rep.ref}`} loading="lazy" />
        </button>
        <figcaption>
          <span class="evidence-ref" title={`画面标识：${rep.ref}`}>
            {rep.ref}
          </span>
          {folded ? (
            <button class="evidence-fold" onClick={() => toggleGroup(rep.ref)} aria-expanded={open}>
              {open ? '收起' : `${group.members.length} 张近重复`}
            </button>
          ) : (
            <span class={`thumb-origin ${rep.origin}`}>{rep.origin === 'evidence' ? '笔记引用' : '时间线画面'}</span>
          )}
        </figcaption>
        {open && group.members.length > 1 && (
          <div class="evidence-fold-strip">
            {group.members.map((m) => (
              <button key={m.ref} class="evidence-zoom-btn small" title={`放大查看 ${m.ref}`} onClick={() => setZoom(m)}>
                <img src={m.dataUrl} alt={`课堂画面 ${m.ref}`} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </figure>
    )
  }
  const zoomDialog = (
    <Dialog
      open={zoom != null}
      kind="view"
      title={zoom != null ? `课堂画面 · ${zoom.ref}` : ''}
      confirmLabel="关闭"
        extraActions={
          onOpenSource != null && zoom != null && manifest.find((m) => m.ref === zoom.ref)?.at != null ? (
            <button
              class="btn small"
              onClick={() => {
                const at = manifest.find((m) => m.ref === (zoom as { ref: string }).ref)?.at ?? 0
                setZoom(null)
                onOpenSource(at)
              }}
            >
              跳到原片
            </button>
          ) : null
        }
      onConfirm={() => setZoom(null)}
      onCancel={() => setZoom(null)}
    >
      {zoom != null && <img class="zoom-image" src={zoom.dataUrl} alt="课堂画面" />}
    </Dialog>
  )
  const framesOf = (items: typeof gallery): ReturnType<typeof foldNearDuplicateFrames> =>
    foldNearDuplicateFrames(
      items.map((img) => ({ ref: img.ref, dataUrl: img.dataUrl, origin: img.origin, hash: manifest.find((m) => m.ref === img.ref)?.hash }))
    )
  // C5: 有章节 → 按章分组的横向胶片条；无章节 → 原折叠网格（零回归）。
  // 容忍部分形状（markdown/obsidian/views 同源纪律）：夹具可能传未过归一层的原始 note。
  const chapters = note.chapters ?? []
  if (chapters.length > 0) {
    const byRef = new Map(gallery.map((g) => [g.ref, g]))
    const chapterGroups = groupFramesByChapters(
      gallery.map((g) => ({ ref: g.ref, at: manifest.find((m) => m.ref === g.ref)?.at ?? null })),
      chapters
    )
    return (
      <>
      <div class="gallery-chapters" data-testid="gallery-chapters">
        {chapterGroups.map((cg, gi) => (
          <section key={cg.chapter?.at ?? `loose-${gi}`} class="gallery-chapter">
            <h4 class="gallery-chapter-title">
              {cg.chapter != null ? (
                <>
                  <span class="gallery-chapter-at">{formatTime(cg.chapter.at)}</span>
                  {cg.chapter.title}
                  <span class="gallery-chapter-summary">{cg.chapter.summary}</span>
                </>
              ) : (
                <span class="gallery-chapter-loose">其他画面</span>
              )}
            </h4>
            <div class="gallery-strip">
              {framesOf(cg.frames.map((f) => byRef.get(f.ref)!).filter(Boolean)).map(renderGroup)}
            </div>
          </section>
        ))}
      </div>
      {zoomDialog}
      </>
    )
  }
  return (
    <div class="evidence-gallery" data-testid="evidence-gallery">
      {framesOf(gallery).map(renderGroup)}
      {zoomDialog}
    </div>
  )
}

