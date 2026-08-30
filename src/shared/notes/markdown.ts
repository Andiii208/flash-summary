import type { Note } from './schema'

/** Markdown export (secondary exchange format per spec §5). */
export function noteToMarkdown(note: Note, title: string): string {
  const lines: string[] = [`# ${title}`, '', note.overview, '', '## 知识结构', '']
  const walk = (node: { title: string; children: Array<{ title: string; children: unknown[] }> }, depth: number): void => {
    lines.push(`${'  '.repeat(depth)}- ${node.title}`)
    for (const child of node.children) walk(child as typeof node, depth + 1)
  }
  walk(note.knowledgeTree as { title: string; children: Array<{ title: string; children: unknown[] }> }, 0)

  lines.push('', '## 时间线', '')
  for (const t of note.timeline) lines.push(`- ${t.title}（${Math.floor(t.at / 60)}分）：${t.detail}`)

  lines.push('', '## 概念', '')
  for (const c of note.concepts) lines.push(`- **${c.term}**：${c.definition}`)

  lines.push('', '## 方法论', '', note.methodology)
  return lines.join('\n')
}
