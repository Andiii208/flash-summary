import type { Note } from './schema'
import type { EvidenceRef, TreeNode } from './schema'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function treeLines(node: TreeNode, depth: number, out: string[]): void {
  out.push(`${'  '.repeat(depth)}- ${node.title}`)
  for (const child of node.children) treeLines(child, depth + 1, out)
}

function timelineSection(note: Note): string[] {
  const lines = ['## 时间线', '']
  for (const entry of note.timeline) {
    lines.push(`- **${formatTime(entry.at)} · ${entry.title}**：${entry.detail}`)
    for (const ref of entry.refs) lines.push(`  > ${ref.text}（${formatTime(ref.at)}）`)
    for (const ev of entry.evidence) lines.push(`  - 证据：${evidenceLabel(ev)}`)
  }
  return lines
}

function evidenceLabel(evidence: EvidenceRef): string {
  return evidence.kind === 'ppt' ? `PPT 第 ${evidence.ref.slice(4)} 页` : `关键帧 ${evidence.ref.slice(3)}`
}

function formulaSection(note: Note): string[] {
  const lines: string[] = []
  const labelOf = (kind: 'formula' | 'code' | 'operation'): string => (kind === 'formula' ? '公式' : kind === 'code' ? '代码' : '操作')
  for (const item of note.formulasAndSteps) {
    const suffix = item.explanation ? ` — ${item.explanation}` : ''
    if (item.kind === 'code') {
      lines.push(`**${labelOf(item.kind)}**${suffix}`, '', '```', item.content, '```', '')
    } else {
      lines.push(`- **${labelOf(item.kind)}**：${item.content}${suffix}`)
    }
  }
  return lines
}

function listSection(heading: string, items: string[]): string[] {
  return items.length === 0 ? [] : ['', `## ${heading}`, '', ...items.map((item) => `- ${item}`)]
}

/** Q/A self-quiz section (roadmap 2.1): answers inline, anchors labeled. */
function quizSection(note: Note): string[] {
  if (note.quiz.length === 0) return []
  const lines = ['', '## 自测题', '']
  note.quiz.forEach((item, i) => {
    const anchor = item.source === 'concept' ? `概念：${item.term ?? ''}` : '考点'
    lines.push(`${i + 1}. **Q**：${item.question}`, `   - **A**：${item.answer}`, `   - 锚点：${anchor}`)
  })
  return lines
}

/** Markdown export (secondary exchange format; structured per 笔记工艺 2026-09-04). */
export function noteToMarkdown(note: Note, title: string): string {
  const tree: string[] = []
  treeLines(note.knowledgeTree, 0, tree)
  const lines: string[] = [`# ${title}`, '', note.overview.trim(), '', '## 知识结构', '', ...tree]
  lines.push('', ...timelineSection(note))
  lines.push('', '## 概念', '', ...note.concepts.map((c) => `- **${c.term}**：${c.definition}`))
  const formulas = formulaSection(note)
  if (formulas.length > 0) lines.push('', '## 公式、代码与操作步骤', '', ...formulas)
  lines.push(...listSection('考试与作业提示', note.examCues))
  lines.push(...listSection('疑问与缺口', note.questionsAndGaps))
  lines.push(...quizSection(note))
  lines.push('', '## 方法论', '', note.methodology.trim())
  return lines.join('\n')
}
