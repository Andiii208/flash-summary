/**
 * 代码块渲染（批4 D8=B, plan 2026-09-17 note-quality upgrade）。
 *
 * 屏幕端与 PDF 讲义此前各自写了一遍 `<pre><code>{content}</code></pre>`——两处样式
 * 就会各自漂移（PDF 端一度连 `pre` 的底色都没有，代码块看起来就是普通文字）。
 * 这个组件是两处共用的单一事实源。
 *
 * 行号规则：**≥3 行才编号**。两三行的片段上行号是纯噪声，而多行代码有行号才方便
 * 指认「第 4 行那个判断写反了」。行号走 CSS 计数器，不进入文本节点——**复制出去
 * 的代码里不会混进行号**（这是刻意选择：行号是排版信息，不是内容）。
 *
 * 每行仍是独立的 `<span>`，行间保留真实换行符，所以选中复制能保持多行结构。
 */
import type { JSX } from 'preact'

/** 低于这个行数不编号（短片段上行号只是噪声）。 */
export const MIN_LINES_FOR_NUMBERS = 3

export interface CodeBlockProps {
  code: string
  /** 给 `<pre>` 的额外 class（两处各有自己的排版类名）。 */
  class?: string
  /** 强制开/关行号；缺省按行数决定。 */
  lineNumbers?: boolean
}

export function CodeBlock({ code, class: extraClass, lineNumbers }: CodeBlockProps): JSX.Element {
  const lines = code.replace(/\r\n/g, '\n').split('\n')
  const numbered = lineNumbers ?? lines.length >= MIN_LINES_FOR_NUMBERS
  const className = ['code-block', numbered ? 'code-numbered' : '', extraClass ?? ''].filter((part) => part !== '').join(' ')
  return (
    <pre class={className}>
      <code>
        {lines.map((line, index) => (
          <span key={index} class="code-line">
            {line}
            {index < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </code>
    </pre>
  )
}
