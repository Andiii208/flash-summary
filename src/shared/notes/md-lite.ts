/**
 * md-lite: a deliberately small markdown subset parser (2026-09-04 笔记工艺).
 *
 * The note's overview/methodology fields are LLM-authored markdown-ish text.
 * This parser turns that into a TOKEN TREE (never an HTML string — the
 * renderer emits Preact JSX, so there is no innerHTML and no XSS surface).
 *
 * Supported subset (all the system prompt asks the model to emit):
 *   ## headings, -/* bullet lists, 1. ordered lists, **bold**, `code`,
 *   > quote lines, blank-line paragraphs.
 *
 * 2026-09-11（声明批3 收口）: + `| a | b |` tables. 起因是设置页「第三方许可」要把
 * THIRD-PARTY-NOTICES.md 渲染给人看，而那份文件的骨架正是表格——不认表格就只能退回
 * 印原文，用户看到一堆竖线。表格是**纯展示**元素（不像链接那样能导航），所以补它不
 * 扩大安全面；顺带让模型偶尔输出的表格在笔记里也不再塌成竖线。
 */

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'code'; v: string }

export type MdBlock =
  | { t: 'heading'; level: number; inline: MdInline[] }
  | { t: 'list'; ordered: boolean; items: MdInline[][] }
  | { t: 'quote'; inline: MdInline[] }
  | { t: 'table'; header: MdInline[][]; rows: MdInline[][][] }
  | { t: 'para'; inline: MdInline[] }

/** Parse inline **bold** / `code` spans (no nesting between the two). */
export function parseInline(text: string): MdInline[] {
  const spans: MdInline[] = []
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) != null) {
    if (match.index > last) spans.push({ t: 'text', v: text.slice(last, match.index) })
    if (match[1] != null) spans.push({ t: 'bold', v: match[1] })
    else spans.push({ t: 'code', v: match[2] ?? '' })
    last = pattern.lastIndex
  }
  if (last < text.length) spans.push({ t: 'text', v: text.slice(last) })
  return spans.length > 0 ? spans : [{ t: 'text', v: '' }]
}

const HEADING = /^(#{1,4})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const ORDERED = /^(\d+)[.、]\s*(.*)$/
const QUOTE = /^>\s?(.*)$/
/** A table's separator row: pipes, dashes (optionally with : alignment) only. */
const TABLE_SEP = /^\|?[\s:|-]*-[\s:|-]*\|?$/

/** `| a | b |` → ['a', 'b'] (outer pipes optional, cells trimmed). */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

/** Parse a block of markdown-lite text into structured blocks. */
export function parseMdLite(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ t: 'para', inline: parseInline(para.join(' ')) })
      para = []
    }
  }
  const flushList = (): void => {
    if (list != null) {
      blocks.push({ t: 'list', ordered: list.ordered, items: list.items.map((i) => parseInline(i)) })
      list = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    if (line.trim() === '') {
      flushPara()
      flushList()
      continue
    }
    // 2026-09-11: a table is a row line followed by a `|---|` separator.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trimEnd())) {
      flushPara()
      flushList()
      const header = splitRow(line).map((cell) => parseInline(cell))
      const rows: MdInline[][][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i].trimEnd()).map((cell) => parseInline(cell)))
        i++
      }
      // Step back once: the for-loop's own i++ must land on the first
      // non-table line, not skip it.
      i--
      blocks.push({ t: 'table', header, rows })
      continue
    }
    const heading = line.match(HEADING)
    if (heading != null) {
      flushPara()
      flushList()
      blocks.push({ t: 'heading', level: heading[1].length, inline: parseInline(heading[2].trim()) })
      continue
    }
    const bullet = line.match(BULLET)
    if (bullet != null) {
      flushPara()
      if (list != null && list.ordered) flushList()
      if (list == null) list = { ordered: false, items: [] }
      list.items.push(bullet[1].trim())
      continue
    }
    const ordered = line.match(ORDERED)
    if (ordered != null) {
      flushPara()
      if (list != null && !list.ordered) flushList()
      if (list == null) list = { ordered: true, items: [] }
      list.items.push(ordered[2].trim())
      continue
    }
    const quote = line.match(QUOTE)
    if (quote != null) {
      flushPara()
      flushList()
      blocks.push({ t: 'quote', inline: parseInline(quote[1]) })
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return blocks
}
