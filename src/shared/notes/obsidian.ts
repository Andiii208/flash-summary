/**
 * Obsidian projection (plan 2026-09-08-obsidian-export): one self-contained
 * structured markdown file per lesson — YAML frontmatter for agents/Dataview,
 * wikilinks so same-named concepts auto-aggregate across lessons, and
 * #flashcards cards the Obsidian Spaced Repetition plugin schedules (FSRS).
 * Pure functions: single fact source for the markdown, attachments are
 * listed (not read) — the main process copies the bytes.
 */
import type { Note, TreeNode } from './schema'
import { formatTime } from './format'
import { formulaSection, listSection } from './markdown'

/** A cited evidence ref with its vault-side attachment file name. */
export interface ObsidianAttachment {
  ref: string
  name: string
}

export interface ObsidianMeta {
  course: string
  lesson: string
  lessonId: string
  origin: 'seu' | 'bilibili'
  /** B站 source only — a public identifier, never a stream URL. */
  bvid?: string | null
  version: number
  /** ISO timestamp of the note version (frontmatter `created`). */
  created: string
  attachments: ObsidianAttachment[]
}

export interface ObsidianExport {
  markdown: string
  /** The attachments the projection actually embeds (main copies these). */
  attachments: ObsidianAttachment[]
}

/** Quote YAML values that carry special characters; plain values stay bare. */
function yamlValue(value: string): string {
  return /^[\w\u4e00-\u9fff.-]+$/.test(value) ? value : JSON.stringify(value)
}

/** Obsidian tags forbid spaces and most punctuation — keep CJK/word chars. */
export function tagSafe(text: string): string {
  const cleaned = text
    .replace(/[^\p{L}\p{N}_/-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim()
  return cleaned !== '' ? cleaned : 'deck'
}

function wikilink(text: string): string {
  return `[[${text}]]`
}

function frontmatter(meta: ObsidianMeta): string[] {
  const lines = [
    '---',
    'source: flash-summary',
    `course: ${yamlValue(meta.course)}`,
    `lesson: ${yamlValue(meta.lesson)}`,
    `lesson_id: ${yamlValue(meta.lessonId)}`,
    `origin: ${meta.origin}`
  ]
  if (meta.origin === 'bilibili' && meta.bvid != null && meta.bvid !== '') lines.push(`bvid: ${yamlValue(meta.bvid)}`)
  lines.push(`version: ${meta.version}`, `created: ${meta.created}`, '---')
  return lines
}

/** Tree → nested list; anchored terms ride along as wikilinks (M2.1 先例). */
function treeSection(node: TreeNode, depth: number, out: string[]): void {
  const terms = node.terms != null && node.terms.length > 0 ? `（概念：${node.terms.map(wikilink).join('、')}）` : ''
  out.push(`${'  '.repeat(depth)}- ${node.title}${terms}`)
  for (const child of node.children) treeSection(child, depth + 1, out)
}

function timelineSection(note: Note, attachments: ObsidianAttachment[]): string[] {
  const lines = ['## 时间线', '']
  const byRef = new Map(attachments.map((a) => [a.ref, a.name]))
  for (const entry of note.timeline) {
    lines.push(`- **${formatTime(entry.at)} · ${entry.title}**：${entry.detail}`)
    for (const ref of entry.refs) lines.push(`  - > ${ref.text}（${formatTime(ref.at)}）`)
    for (const ev of entry.evidence) {
      const name = byRef.get(ev.ref)
      if (name != null) lines.push(`  - ![[${name}]]`)
    }
  }
  return lines
}

function conceptSection(note: Note): string[] {
  if (note.concepts.length === 0) return []
  return ['## 概念', '', ...note.concepts.map((c) => `- **${wikilink(c.term)}**：${c.definition}`)]
}

/**
 * SR cards (plugin syntax, README-verified): concept cards single-line
 * `[[term]]::definition`; quiz cards multi-line `Q / ? / A` with a blank
 * line between cards. The deck tag sits on the heading line.
 */
function flashcardSection(note: Note, meta: ObsidianMeta): string[] {
  if (note.concepts.length === 0 && note.quiz.length === 0) return []
  const deck = `#flashcards/${tagSafe(meta.course)}/${tagSafe(meta.lesson)}`
  const lines: string[] = ['', `## 自测 ${deck}`, '']
  for (const concept of note.concepts) lines.push(`${wikilink(concept.term)}::${concept.definition.replace(/\s*\n\s*/g, ' ')}`, '')
  for (const item of note.quiz) lines.push(item.question, '?', item.answer, '')
  return lines
}

/** The whole lesson file; empty sections are omitted (投影纪律). */
export function projectObsidianNote(note: Note, meta: ObsidianMeta): ObsidianExport {
  const lines = [...frontmatter(meta), '', `# ${meta.lesson}`, '']
  if (note.overview.trim() !== '') lines.push('## 概览', '', note.overview.trim(), '')
  const tree: string[] = []
  treeSection(note.knowledgeTree, 0, tree)
  lines.push('## 知识结构', '', ...tree)
  if (note.timeline.length > 0) lines.push('', ...timelineSection(note, meta.attachments))
  lines.push(...conceptSection(note))
  const formulas = formulaSection(note)
  if (formulas.length > 0) lines.push('', ...formulas)
  lines.push(...listSection('考试与作业提示', note.examCues))
  if (note.questionsAndGaps.length > 0) lines.push('', '## 疑问与缺口', '', ...note.questionsAndGaps.map((gap) => `- [ ] ${gap}`))
  lines.push(...flashcardSection(note, meta))
  if (note.methodology.trim() !== '') lines.push('', '## 方法论', '', note.methodology.trim(), '')
  return { markdown: lines.join('\n'), attachments: meta.attachments }
}
