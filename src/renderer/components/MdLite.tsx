import type { JSX } from 'preact'
import { memo } from 'preact/compat'
import { useEffect, useRef } from 'preact/hooks'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { parseMdLite, type MdInline } from '../../shared/notes/md-lite'

/**
 * 批4 (plan 2026-09-17 note-quality upgrade): 公式渲染。
 *
 * 守住 md-lite 的铁律——**解析器只产 token、绝不产 HTML 字符串**。所以这里不用
 * `katex.renderToString()`（那会产 HTML 串、逼我们用 innerHTML），而是
 * `katex.render(tex, container)` 渲染进一个 ref 元素：容器由 Preact 创建，
 * 字符串从不经过我们的手。
 *
 * 安全：KaTeX 的 `trust` 默认为 false（`\htmlClass`/`\includegraphics` 等被禁），
 * 且不开 `strict: false`，畸形 LaTeX 会抛错——下面把错误降级为原文显示，
 * 一份笔记不该因为一条公式写错而整块渲染失败。
 */
function useKatex(tex: string, displayMode: boolean): { ref: { current: HTMLSpanElement | null } } {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const host = ref.current
    if (host == null) return
    host.textContent = ''
    try {
      katex.render(tex, host, { displayMode, throwOnError: true, output: 'htmlAndMathml' })
    } catch {
      host.textContent = displayMode ? `$$${tex}$$` : `$${tex}$`
      host.classList.add('md-math-error')
    }
  }, [tex, displayMode])
  return { ref }
}

function MathSpan({ tex, displayMode }: { tex: string; displayMode: boolean }): JSX.Element {
  const { ref } = useKatex(tex, displayMode)
  return displayMode ? <span ref={ref} class="md-math-block" /> : <span ref={ref} class="md-math" />
}

/** Render one inline span list (**bold** / `code` / $math$) as Preact children.
 *  批4: exported — InlineText reuses it for single-line note fields. */
export function Inline({ spans }: { spans: MdInline[] }): JSX.Element {
  return (
    <>
      {spans.map((span, i) => {
        if (span.t === 'bold') return <strong key={i}>{span.v}</strong>
        if (span.t === 'code') return <code key={i}>{span.v}</code>
        if (span.t === 'math') return <MathSpan key={i} tex={span.v} displayMode={false} />
        return <span key={i}>{span.v}</span>
      })}
    </>
  )
}

/**
 * Markdown-lite renderer: parse to tokens, emit JSX only — no innerHTML
 * anywhere, so LLM text can never inject markup (CSP-safe by construction).
 *
 * 批4: memo——props 只有一个 text 字符串；父层（NoteViewer / App）的无关 state
 * 变更不再触发整棵子树重解析重渲染（渲染层性能）。
 */
export const MdLite = memo(function MdLite({ text }: { text: string }): JSX.Element {
  const blocks = parseMdLite(text)
  return (
    <div class="md-lite">
      {blocks.map((block, i) => {
        switch (block.t) {
          case 'heading': {
            // 批6 (plan 2026-09-07 v07): markdown headings render as h4-h6 —
            // h3 competed with the page skeleton's section headings.
            const level = Math.min(block.level + 3, 6)
            const Tag = `h${level}` as 'h3'
            return (
              <Tag key={i} class={`md-h md-h${block.level}`}>
                <Inline spans={block.inline} />
              </Tag>
            )
          }
          case 'list':
            return block.ordered ? (
              <ol key={i} class="md-list md-ordered">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline spans={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} class="md-list">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline spans={item} />
                  </li>
                ))}
              </ul>
            )
          case 'quote':
            return (
              <blockquote key={i} class="md-quote">
                <Inline spans={block.inline} />
              </blockquote>
            )
          case 'table':
            // 2026-09-11（声明批3 收口）: tables are pure presentation — the reason
            // this exists is the third-party notices document, whose backbone is a
            // table per component. Emitted as real <table> JSX (no innerHTML).
            return (
              <table key={i} class="md-table">
                <thead>
                  <tr>
                    {block.header.map((cell, j) => (
                      <th key={j}>
                        <Inline spans={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td key={k}>
                          <Inline spans={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          case 'math':
            return <MathSpan key={i} tex={block.tex} displayMode />
          default:
            return (
              <p key={i} class="md-para">
                <Inline spans={block.inline} />
              </p>
            )
        }
      })}
    </div>
  )
})
