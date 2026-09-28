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
  /** 批4: 行内公式 `$...$`。tex 是原始 LaTeX，渲染由渲染层交给 KaTeX。 */
  | { t: 'math'; v: string }
  /** P29 (plan 2026-09-21): 荧光笔 `==...==`，渲染为 `<mark>`。 */
  | { t: 'mark'; v: string }

export type MdBlock =
  | { t: 'heading'; level: number; inline: MdInline[] }
  | { t: 'list'; ordered: boolean; items: MdInline[][] }
  | { t: 'quote'; inline: MdInline[] }
  | { t: 'table'; header: MdInline[][]; rows: MdInline[][][] }
  | { t: 'para'; inline: MdInline[] }
  /** 批4: 块级公式 `$$...$$`（单行或跨行），居中独占一段。 */
  | { t: 'math'; tex: string }

/**
 * Parse inline **bold** / `code` / $math$ / ==mark== spans (no nesting between them).
 *
 * 批4: 行内公式的定界符是 `$...$`——**要求两侧不贴空格**（`$x$` 是公式，
 * 「花了 $5 和 $10」不是），这是通用 markdown 数学插件的既有约定，避免把
 * 货币符号误当公式。反斜杠转义的 `\$` 不算定界符。
 *
 * P29 (plan 2026-09-21): 荧光笔 `==...==`——正则按位置从左到右匹配，`$`
 * 分支先于 `==`，所以公式里的等号（`$a == b$`）不会被误当高亮；未闭合的
 * 单个 `==`（如「a == b」）不匹配、原样留文本（与 `$$` 的未闭合降级同纪律）。
 */
export function parseInline(text: string): MdInline[] {
  const spans: MdInline[] = []
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\$([^\s$][^$]*[^\s$]|[^\s$])\$|==([^=]+)==/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) != null) {
    if (match.index > last) spans.push({ t: 'text', v: text.slice(last, match.index) })
    if (match[1] != null) spans.push({ t: 'bold', v: match[1] })
    else if (match[2] != null) spans.push({ t: 'code', v: match[2] })
    else if (match[3] != null) spans.push({ t: 'math', v: match[3] })
    else spans.push({ t: 'mark', v: match[4] ?? '' })
    last = pattern.lastIndex
  }
  if (last < text.length) spans.push({ t: 'text', v: text.slice(last) })
  return spans.length > 0 ? spans : [{ t: 'text', v: '' }]
}

/**
 * 把行内 markdown 还原成纯文本（批4, plan 2026-09-28 H3）。
 *
 * 用在哪：`title=` / `aria-label=` / `alt=` 这些**放不了元素**的属性上下文——
 * 模型会在概念名、术语、章节摘要里自由输出 `**加粗**` 与 `==高亮==`，原样插值
 * 会把字面星号印进 tooltip 和无障碍名。这里复用 `parseInline` 的 token 序列取
 * 出文本值（**不另写一套正则**——解析规则全站只有一份）。
 */
export function toPlainText(text: string): string {
  return parseInline(text)
    .map((span) => span.v)
    .join('')
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

/**
 * 文本里是否含至少一张 markdown 表格（「一行带竖线 + 下一行是分隔行」）。
 *
 * 批4 (plan 2026-09-17 note-quality upgrade)：`views.looksLikeMarkdown` 此前只认
 * 标题/列表/加粗，**不认表格**——一份只有表格的 overview 会走纯 `<p>` 分支把竖线
 * 原样印出来。判据必须只有一份，所以放在解析器这里导出，由调用方复用。
 */
export function hasTable(text: string): boolean {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].includes('|') && TABLE_SEP.test(lines[i + 1].trimEnd())) return true
  }
  return false
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
    // 批4: 块级公式 `$$...$$`（单行闭合或跨行），独占一段、居中渲染。
    // 先于行内解析处理，否则 `$$` 会被行内规则当成两个空的 `$...$`。
    // **先前瞻找闭合再消费**：未闭合时必须原样落到普通段落，绝不能把后面
    // 整篇内容吞掉（一次就会毁掉整份笔记的渲染）。
    if (line.trim().startsWith('$$')) {
      const first = line.trim().slice(2)
      const sameLine = first.indexOf('$$')
      let tex: string | null = null
      let consumedTo = i
      let trailing = ''
      if (sameLine >= 0) {
        tex = first.slice(0, sameLine)
        trailing = first.slice(sameLine + 2).trim()
      } else {
        const collected = [first]
        for (let j = i + 1; j < lines.length; j++) {
          const end = lines[j].indexOf('$$')
          if (end >= 0) {
            collected.push(lines[j].slice(0, end))
            trailing = lines[j].slice(end + 2).trim()
            tex = collected.join('\n')
            consumedTo = j
            break
          }
          collected.push(lines[j])
        }
      }
      if (tex != null) {
        flushPara()
        flushList()
        const trimmedTex = tex.trim()
        if (trimmedTex !== '') blocks.push({ t: 'math', tex: trimmedTex })
        i = consumedTo
        if (trailing !== '') para.push(trailing)
        continue
      }
      // 未闭合 → 交给下面的常规分支（落到段落），行为与普通文本一致。
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
