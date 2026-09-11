import type { JSX } from 'preact'
import { parseMdLite, type MdInline } from '../../shared/notes/md-lite'

/** Render one inline span list (**bold** / `code`) as Preact children.
 *  批4: exported — InlineText reuses it for single-line note fields. */
export function Inline({ spans }: { spans: MdInline[] }): JSX.Element {
  return (
    <>
      {spans.map((span, i) => {
        if (span.t === 'bold') return <strong key={i}>{span.v}</strong>
        if (span.t === 'code') return <code key={i}>{span.v}</code>
        return <span key={i}>{span.v}</span>
      })}
    </>
  )
}

/**
 * Markdown-lite renderer: parse to tokens, emit JSX only — no innerHTML
 * anywhere, so LLM text can never inject markup (CSP-safe by construction).
 */
export function MdLite({ text }: { text: string }): JSX.Element {
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
}
