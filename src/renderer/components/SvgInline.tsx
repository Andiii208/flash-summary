/**
 * 批4 (plan 2026-09-28 H3): SVG 内的行内 markdown 映射。
 *
 * 问题：模型会在导图节点标题、关系术语、章节标题里自由输出 `**加粗**` 与
 * `==高亮==`，而 SVG `<text>` 里**放不了 HTML 元素**（`<strong>`/`<mark>` 在
 * SVG namespace 里不存在）——笔记正文那套 `<InlineText>` 在这里用不上，原样
 * 插值就只能把字面星号印进导图与 PDF。
 *
 * 做法：复用 md-lite 的 `parseInline` token 序列（解析规则只有一份），把文本
 * 切成若干**分段**，每段映射成一个 `<tspan>`：
 *   - strong → font-weight（`md-svg-bold` 类，font-weight:700）
 *   - mark   → 文字色取荧光笔底色的深色变体（`md-svg-mark` 类）——tspan 铺不了
 *     背景（要按字形测量画矩形），用文字色区分，浅/暗各一份（print.css 对
 *     纸面白底另钉一份固定深色，见该文件）
 *   - code/math → 取文本值（不印定界符）
 *
 * 两个必须守住的细节：
 *   1. **跨行样式连续**：节点标题是先被 `wrapTitleLines` 按**原文字符数**断行
 *      再交给我们的，一对 `**加粗**` 可能正好被断在行界上——甚至断在两个星号
 *      中间。所以这里**先在整段原文上解析**（配对语义与正文完全一致），再把
 *      每个 token 的原文区间按行界切开：记号字符不产出任何 tspan，样式区间
 *      跨行时两半都保持样式。正文里未配对的裸记号（如「a == b」、公式
 *      `f(x)=`）与正文路径同纪律——原样留文本，不吞。
 *   2. **x 基准不漂移**：x 只落在每行的第一个分段上，后续分段不带 x 即续在
 *      同一文本块里——整行保持同一个 text-anchor 基准（start 不缩进、middle
 *      仍整段居中），不会因为分段把中文字符宽的标题挪位。dy 同理：每行首段
 *      携带行距，续段不带。
 */
import type { JSX } from 'preact'
import { parseInline } from '../../shared/notes/md-lite'

/** 一段可视文本及其行内样式。 */
export interface SvgSegment {
  text: string
  bold: boolean
  mark: boolean
}

/** 一个 token 在**原文**中的字符区间（定界符本身不产出字符）。 */
interface StyledRange {
  start: number
  end: number
  bold: boolean
  mark: boolean
}

/**
 * parseInline 的 token 序列 → 原文区间。
 * 定界符宽度：`**`/`==` 两侧各占位，code/math 的反引号与 `$` 各占 1 字符。
 */
function styledRanges(raw: string): StyledRange[] {
  const ranges: StyledRange[] = []
  let cursor = 0
  for (const span of parseInline(raw)) {
    if (span.t === 'text') {
      ranges.push({ start: cursor, end: cursor + span.v.length, bold: false, mark: false })
      cursor += span.v.length
    } else if (span.t === 'bold') {
      ranges.push({ start: cursor + 2, end: cursor + 2 + span.v.length, bold: true, mark: false })
      cursor += span.v.length + 4
    } else if (span.t === 'mark') {
      ranges.push({ start: cursor + 2, end: cursor + 2 + span.v.length, bold: false, mark: true })
      cursor += span.v.length + 4
    } else {
      // code / math：只取文本值（定界符是 ` 或 $，两侧各 1 字符）
      ranges.push({ start: cursor + 1, end: cursor + 1 + span.v.length, bold: false, mark: false })
      cursor += span.v.length + 2
    }
  }
  return ranges
}

/**
 * 按 `wrapTitleLines` 的行界把样式区间切开：一行可含多个区间片段，一个区间
 * 也可跨行（切成两段，样式连续）。返回 null = 行界与原文对不齐（wrap 丢字符
 * 的理论情形），调用方走 bestEffort 兜底。
 */
function splitByLines(raw: string, lines: readonly string[]): SvgSegment[][] | null {
  if (lines.join('') !== raw) return null
  const ranges = styledRanges(raw)
  const perLine: SvgSegment[][] = lines.map(() => [])
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = offset + lines[i]!.length
    for (const range of ranges) {
      const from = Math.max(range.start, offset)
      const to = Math.min(range.end, lineEnd)
      if (to > from) perLine[i]!.push({ text: raw.slice(from, to), bold: range.bold, mark: range.mark })
    }
    offset = lineEnd
  }
  return perLine
}

/** 对不齐时的兜底：逐行取 parseInline 的文本值（与正文路径同结果）。 */
function bestEffortLines(lines: readonly string[]): SvgSegment[][] {
  return lines.map((line) => {
    const parts = parseInline(line).map((span) => ({ text: span.v, bold: false, mark: false }))
    return parts.filter((part) => part.text !== '')
  })
}

/** 分段 → tspan 的表现类（strong/mark 各一套，普通段不带类）。 */
function segmentClass(segment: SvgSegment): string | undefined {
  if (segment.bold) return 'md-svg-bold'
  if (segment.mark) return 'md-svg-mark'
  return undefined
}

/** 一行的分段 → tspan 组；x/dy 只写给行首段（续段续在同一文本块里）。 */
function renderLine(parts: SvgSegment[], lineIndex: number, x: number | undefined, dy: number, lineStep: number): JSX.Element[] {
  const headDy = lineIndex === 0 ? dy : lineStep
  // 整行都是记号（parts 为空）时渲染空 tspan 占位——几何层按行数算高，行不能少
  if (parts.length === 0) return [<tspan key={lineIndex} x={x} dy={headDy} />]
  return parts.map((part, j) => (
    <tspan
      key={`${lineIndex}-${j}`}
      x={j === 0 ? x : undefined}
      dy={j === 0 ? headDy : undefined}
      class={segmentClass(part)}
    >
      {part.text}
    </tspan>
  ))
}

/**
 * 不换行的单行文本（关系标签等）。x 给首段（居中标签给 0——与父 `<text>` 的
 * 默认 x 等价，整块仍按 text-anchor 居中）。
 */
export function SvgTspans({ text, x, dy = 0 }: { text: string; x?: number; dy?: number }): JSX.Element {
  const perLine = splitByLines(text, [text]) ?? bestEffortLines([text])
  return <>{renderLine(perLine[0] ?? [], 0, x, dy, 0)}</>
}

/**
 * 已由 `wrapTitleLines` 断好的多行文本：先在整段原文上解析，再按行界切分。
 * lineStep = 每行的行距（标题 18 / 术语子行 14，与几何层的 LINE_HEIGHT/SUBLINE_HEIGHT 一致）。
 */
export function SvgLineTspans({ lines, x, lineStep }: { lines: readonly string[]; x: number; lineStep: number }): JSX.Element {
  const raw = lines.join('')
  const perLine = splitByLines(raw, lines) ?? bestEffortLines(lines)
  return <>{perLine.map((parts, i) => renderLine(parts, i, x, 0, lineStep))}</>
}
