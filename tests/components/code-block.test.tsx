/**
 * 批4 D8=B (plan 2026-09-17) 单测：共享代码块渲染与行号规则。
 *
 * 屏幕端与 PDF 讲义此前各写了一遍 `<pre><code>`，PDF 端连底色都没有。现在两处
 * 共用 `CodeBlock`，行号规则也只有一个事实源：**≥3 行才编号**。
 */
import { describe, expect, it } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { CodeBlock, MIN_LINES_FOR_NUMBERS } from '../../src/renderer/components/CodeBlock'

function mount(props: Parameters<typeof CodeBlock>[0]): HTMLElement {
  const host = document.createElement('div')
  act(() => render(<CodeBlock {...props} />, host))
  return host
}

describe('CodeBlock 共享代码块（批4 D8=B）', () => {
  it('单行代码：不编号（短片段上行号是纯噪声）', () => {
    const host = mount({ code: 'print("hi")' })
    expect(host.querySelector('pre.code-block')).not.toBeNull()
    expect(host.querySelector('pre')?.className).not.toContain('code-numbered')
    expect(host.querySelectorAll('.code-line')).toHaveLength(1)
  })

  it('两行仍不编号；达到阈值才编号', () => {
    expect(MIN_LINES_FOR_NUMBERS).toBe(3)
    expect(mount({ code: 'a\nb' }).querySelector('pre')?.className).not.toContain('code-numbered')
    expect(mount({ code: 'a\nb\nc' }).querySelector('pre')?.className).toContain('code-numbered')
  })

  it('每行一个 .code-line，且行间保留真实换行符（选中复制保持多行）', () => {
    const host = mount({ code: 'line1\nline2\nline3' })
    expect(host.querySelectorAll('.code-line')).toHaveLength(3)
    // 文本里必须带换行——行号走 CSS 计数器不进文本，复制出去的代码不带行号
    expect(host.textContent).toBe('line1\nline2\nline3')
    expect(host.textContent).not.toMatch(/^\s*1\s/m)
  })

  it('行号可由调用方强制开关', () => {
    expect(mount({ code: 'a\nb', lineNumbers: true }).querySelector('pre')?.className).toContain('code-numbered')
    expect(mount({ code: 'a\nb\nc\nd', lineNumbers: false }).querySelector('pre')?.className).not.toContain('code-numbered')
  })

  it('CRLF 输入按行拆开（Windows 粘贴的代码不会变成一整行）', () => {
    expect(mount({ code: 'a\r\nb\r\nc' }).querySelectorAll('.code-line')).toHaveLength(3)
  })

  it('额外 class 透传给 pre（屏幕端 formula-code / PDF 端各自的排版）', () => {
    const host = mount({ code: 'x', class: 'formula-code' })
    const pre = host.querySelector('pre')
    expect(pre?.className).toContain('formula-code')
    expect(pre?.className).toContain('code-block')
  })

  it('内容原样输出、不经 HTML（保留缩进与特殊字符）', () => {
    const source = '  <div>\n    &amp; "引号"\n  中文缩进'
    const host = mount({ code: source })
    expect(host.textContent).toBe(source)
    expect(host.querySelector('div')).toBeNull()
  })
})
