/**
 * 批4 (plan 2026-09-17 note-quality upgrade) 渲染测试：MdLite 的公式与表格。
 *
 * 公式此前只当纯文本渲染（`$...$` 与 `\frac` 原样印出）。这批接 KaTeX，
 * 但必须守住 md-lite 铁律——**parser 只产 token，渲染层用 katex.render(tex, el)
 * 渲进 ref 元素**，不经过 renderToString/innerHTML。下面的断言正是钉这条：
 * 输出里应当出现 KaTeX 自己的 DOM 结构（.katex），而不是我们把 HTML 串塞进去。
 */
import { describe, expect, it } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { MdLite } from '../../src/renderer/components/MdLite'

/** KaTeX 渲染发生在 useEffect 里（刻意不用 renderToString），所以要 flush 一次。 */
function renderMath(text: string): HTMLElement {
  const host = document.createElement('div')
  act(() => {
    render(<MdLite text={text} />, host)
  })
  return host
}

describe('MdLite 公式渲染 (批4)', () => {
  it('行内 $...$ 渲染成 KaTeX 结构，且不再印出美元符号', () => {
    const host = renderMath('圆面积为 $\\pi r^2$ 所以')
    expect(host.querySelector('.katex')).not.toBeNull()
    expect(host.textContent).not.toContain('$')
    expect(host.textContent).toContain('所以')
  })

  it('块级 $$...$$ 独占一段、带 display 模式', () => {
    const host = renderMath('$$\nL = -\\sum_i y_i \\log p_i\n$$')
    expect(host.querySelector('.katex-display')).not.toBeNull()
    expect(host.querySelector('.md-math-block')).not.toBeNull()
  })

  it('畸形 LaTeX 降级显示原文，不让整块渲染失败', () => {
    const host = renderMath('前文 $\\frac{a}{$ 后文')
    // 不该抛错、不该白屏：段落文字仍在
    expect(host.textContent).toContain('前文')
    expect(host.textContent).toContain('后文')
  })

  it('货币符号不被当公式（不出现 katex 结构）', () => {
    const host = renderMath('这件商品花了 $5 和 $10 元')
    expect(host.querySelector('.katex')).toBeNull()
    expect(host.textContent).toBe('这件商品花了 $5 和 $10 元')
  })

  it('公式与列表/表格共存，不破坏既有渲染', () => {
    const host = renderMath('## 小节\n- 含公式 $a+b$ 的条目\n\n| k | v |\n|---|---|\n| 1 | 2 |')
    expect(host.querySelector('table.md-table')).not.toBeNull()
    expect(host.querySelectorAll('li')).toHaveLength(1)
    expect(host.querySelector('.katex')).not.toBeNull()
  })
})
