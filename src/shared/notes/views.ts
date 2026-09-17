/**
 * The reading views (spec §5) are filtered/reorganized projections of the
 * same structured note JSON — never four independent summaries.
 *
 * Two projection layers (2026-09-04 笔记工艺):
 *   - projectNote: legacy flat text sections (Markdown export paths).
 *   - projectNoteBlocks: structured ViewBlock trees consumed by the
 *     renderer's five views (four reading tabs + mindmap). Pure functions.
 */
import type { Note, TimelineEntry, Concept, FormulaOrStep, TreeNode, QuizItem } from './schema'
import { formatTime, labelOf } from './format'
import { hasTable } from './md-lite'

export type ViewId = 'detailed' | 'standard' | 'key_points' | 'methodology' | 'mindmap'

export const VIEW_IDS: ViewId[] = ['detailed', 'standard', 'key_points', 'methodology', 'mindmap']

export interface ViewSection {
  heading: string
  /** Plain text lines (already joined content, no HTML). */
  lines: string[]
}

/** One renderable block in a view. Discriminated by `block`. */
export type ViewBlock =
  | { block: 'paragraph'; text: string }
  | { block: 'markdown'; text: string }
  | { block: 'tree'; node: TreeNode }
  | { block: 'timeline'; entries: TimelineEntry[] }
  | { block: 'concepts'; items: Concept[] }
  | { block: 'formulas'; items: FormulaOrStep[] }
  | { block: 'callout'; tone: 'exam' | 'gap'; items: string[] }
  | { block: 'steps'; items: Array<{ content: string; explanation: string }> }
  | { block: 'quiz'; items: QuizItem[] }

export interface BlockSection {
  heading: string
  blocks: ViewBlock[]
}

/** Project a note into the requested view. Pure function. */
export function projectNote(note: Note, view: ViewId): ViewSection[] {
  switch (view) {
    case 'detailed':
      return detailedView(note)
    case 'standard':
      return standardView(note)
    case 'key_points':
      return keyPointsView(note)
    case 'methodology':
      return methodologyView(note)
    default:
      return []
  }
}

/** Structured projection for the renderer's five views (2026-09-04). */
export function projectNoteBlocks(note: Note, view: ViewId): BlockSection[] {
  switch (view) {
    case 'detailed':
      return detailedBlocks(note)
    case 'standard':
      return standardBlocks(note)
    case 'key_points':
      return keyPointsBlocks(note)
    case 'methodology':
      return methodologyBlocks(note)
    case 'mindmap':
      return mindmapBlocks(note)
  }
}

// ---------------- legacy flat projections ----------------

function detailedView(note: Note): ViewSection[] {
  return [
    { heading: '课程概览', lines: [note.overview] },
    { heading: '知识结构', lines: flattenTree(note.knowledgeTree) },
    { heading: '时间线', lines: note.timeline.map((t) => `${formatTime(t.at)} ${t.title} — ${t.detail}`) },
    { heading: '概念与定义', lines: note.concepts.map((c) => `${c.term}：${c.definition}`) },
    {
      heading: '公式、代码与操作步骤',
      lines: note.formulasAndSteps.map((f) => `[${labelOf(f.kind)}] ${f.content}${f.explanation ? ` — ${f.explanation}` : ''}`)
    },
    { heading: '考试与作业提示', lines: note.examCues },
    { heading: '疑问与缺口', lines: note.questionsAndGaps },
    {
      heading: '证据引用',
      lines: note.evidence.map((e) => (e.kind === 'ppt' ? `PPT 第 ${e.ref} 页` : `关键帧 ${e.ref}`))
    }
  ]
}

function standardView(note: Note): ViewSection[] {
  return [
    { heading: '课程概览', lines: [note.overview] },
    { heading: '知识结构', lines: flattenTree(note.knowledgeTree) },
    { heading: '重点概念', lines: note.concepts.slice(0, 8).map((c) => `${c.term}：${c.definition}`) }
  ]
}

function keyPointsView(note: Note): ViewSection[] {
  const points = [
    ...note.examCues.map((c) => `【考点】${c}`),
    ...note.questionsAndGaps.map((q) => `【待解决】${q}`),
    ...note.timeline.slice(0, 5).map((t) => `【${formatTime(t.at)}】${t.title}`)
  ]
  return [{ heading: '要点', lines: points }]
}

function methodologyView(note: Note): ViewSection[] {
  return [
    { heading: '方法论分析', lines: [note.methodology] },
    {
      heading: '步骤与方法',
      lines: note.formulasAndSteps.filter((f) => f.kind === 'operation' || f.kind === 'code').map((f) => f.content)
    }
  ]
}

function flattenTree(node: { title: string; children: unknown[] }, depth = 0): string[] {
  const lines = [`${'  '.repeat(depth)}${depth > 0 ? '- ' : ''}${node.title}`]
  for (const child of node.children as Array<{ title: string; children: unknown[] }>) {
    lines.push(...flattenTree(child, depth + 1))
  }
  return lines
}


// ---------------- structured block projections ----------------

/** Shared: does this string look like markdown (## / list / bold / table)? */
export function looksLikeMarkdown(text: string): boolean {
  // 批4: 补表格判据。此前只有「## / 列表 / 加粗」三条，一份**只有表格**的
  // overview 会落到纯 `<p>` 分支，把 `|` 原样印出来。
  return /(^|\n)\s{0,3}(#{1,4}\s|[-*]\s|\d+\.\s)/.test(text) || /\*\*[^*]+\*\*/.test(text) || hasTable(text)
}

function detailedBlocks(note: Note): BlockSection[] {
  const sections: BlockSection[] = [
    { heading: '课程概览', blocks: [markdownBlock(note.overview)] },
    { heading: '知识结构', blocks: [{ block: 'tree', node: note.knowledgeTree }] },
    { heading: '时间线', blocks: note.timeline.length > 0 ? [{ block: 'timeline', entries: note.timeline }] : [] },
    { heading: '概念与定义', blocks: conceptBlocks(note.concepts) },
    ...formulaSections(note)
  ]
  if (note.examCues.length > 0) sections.push({ heading: '考试与作业提示', blocks: [{ block: 'callout', tone: 'exam', items: note.examCues }] })
  if (note.questionsAndGaps.length > 0) sections.push({ heading: '疑问与缺口', blocks: [{ block: 'callout', tone: 'gap', items: note.questionsAndGaps }] })
  return sections.filter((s) => s.blocks.length > 0)
}

function standardBlocks(note: Note): BlockSection[] {
  const sections: BlockSection[] = [
    { heading: '课程概览', blocks: [markdownBlock(note.overview)] },
    { heading: '知识结构', blocks: [{ block: 'tree', node: note.knowledgeTree }] },
    { heading: '重点概念', blocks: conceptBlocks(note.concepts.slice(0, 8)) }
  ]
  if (note.examCues.length > 0) sections.push({ heading: '考点速览', blocks: [{ block: 'callout', tone: 'exam', items: note.examCues }] })
  return sections.filter((s) => s.blocks.length > 0)
}

function keyPointsBlocks(note: Note): BlockSection[] {
  const blocks: ViewBlock[] = []
  if (note.examCues.length > 0) blocks.push({ block: 'callout', tone: 'exam', items: note.examCues })
  if (note.questionsAndGaps.length > 0) blocks.push({ block: 'callout', tone: 'gap', items: note.questionsAndGaps })
  if (note.timeline.length > 0) {
    blocks.push({ block: 'timeline', entries: note.timeline.slice(0, 5) })
  }
  // Cornell Cue semantics: the quiz is the self-test hook of the key points
  // view; empty quiz omits the whole section (empty-section discipline).
  const sections: BlockSection[] = [{ heading: '要点', blocks }]
  if (note.quiz.length > 0) sections.push({ heading: '自测题', blocks: [{ block: 'quiz', items: note.quiz }] })
  return sections.some((s) => s.blocks.length > 0) ? sections.filter((s) => s.blocks.length > 0) : []
}

function methodologyBlocks(note: Note): BlockSection[] {
  const sections: BlockSection[] = [{ heading: '方法论分析', blocks: [markdownBlock(note.methodology)] }]
  const steps = note.formulasAndSteps
    .filter((f) => f.kind === 'operation' || f.kind === 'code')
    .map((f) => ({ content: f.content, explanation: f.explanation }))
  if (steps.length > 0) sections.push({ heading: '步骤与方法', blocks: [{ block: 'steps', items: steps }] })
  return sections
}

function mindmapBlocks(note: Note): BlockSection[] {
  return [
    { heading: '知识导图', blocks: [{ block: 'tree', node: note.knowledgeTree }] },
    { heading: '概览', blocks: [markdownBlock(note.overview)] }
  ]
}

function markdownBlock(text: string): ViewBlock {
  return looksLikeMarkdown(text) ? { block: 'markdown', text } : { block: 'paragraph', text }
}

function conceptBlocks(items: Concept[]): ViewBlock[] {
  return items.length > 0 ? [{ block: 'concepts', items }] : []
}

/** Formula/code/operation rendered as one section of typed blocks. */
function formulaSections(note: Note): BlockSection[] {
  if (note.formulasAndSteps.length === 0) return []
  return [{ heading: '公式、代码与操作步骤', blocks: [{ block: 'formulas', items: note.formulasAndSteps }] }]
}
