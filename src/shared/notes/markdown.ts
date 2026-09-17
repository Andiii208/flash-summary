import type { Note } from './schema'
import { formatTime, labelOf } from './format'
import type { EvidenceRef, TreeNode } from './schema'

function treeLines(node: TreeNode, depth: number, out: string[]): void {
  // M2.1: anchored concepts ride along in the outline so the exported
  // structure keeps the map's content linkage.
  const terms = node.terms != null && node.terms.length > 0 ? `（概念：${node.terms.join('、')}）` : ''
  out.push(`${'  '.repeat(depth)}- ${node.title}${terms}`)
  for (const child of node.children) treeLines(child, depth + 1, out)
}

/**
 * 批2 (plan 2026-09-17 note-quality upgrade): 概念行 + 可选的具体例子。
 * 没有 example 就只出一行——宁空勿编，缺失的字段不该在导出里留空壳。
 */
function conceptLines(concept: Note['concepts'][number]): string[] {
  const head = `- **${concept.term}**：${concept.definition}`
  const example = concept.example != null ? concept.example.trim() : ''
  return example === '' ? [head] : [head, `  - 例：${example}`]
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

/** Shared with the Obsidian projection (plan 2026-09-08-obsidian-export) —
 *  the formula/step block shape is identical markdown. */
export function formulaSection(note: Note): string[] {
  const lines: string[] = []
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

/** Shared with the Obsidian projection — same heading + list shape. */
export function listSection(heading: string, items: string[]): string[] {
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
  lines.push('', '## 概念', '', ...note.concepts.flatMap(conceptLines))
  const formulas = formulaSection(note)
  if (formulas.length > 0) lines.push('', '## 公式、代码与操作步骤', '', ...formulas)
  lines.push(...listSection('考试与作业提示', note.examCues))
  lines.push(...listSection('疑问与缺口', note.questionsAndGaps))
  lines.push(...quizSection(note))
  lines.push('', '## 方法论', '', note.methodology.trim())
  return lines.join('\n')
}
