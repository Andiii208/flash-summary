/**
 * The four reading views (spec §5) are filtered/reorganized projections of
 * the same structured note JSON — never four independent summaries.
 */
import type { Note } from './schema'

export type ViewId = 'detailed' | 'standard' | 'key_points' | 'methodology'

export const VIEW_IDS: ViewId[] = ['detailed', 'standard', 'key_points', 'methodology']

export interface ViewSection {
  heading: string
  /** Plain text lines (already joined content, no HTML). */
  lines: string[]
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
  }
}

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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function labelOf(kind: 'formula' | 'code' | 'operation'): string {
  switch (kind) {
    case 'formula':
      return '公式'
    case 'code':
      return '代码'
    case 'operation':
      return '操作'
  }
}
