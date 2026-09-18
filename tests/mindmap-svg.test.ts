import { describe, expect, it } from 'vitest'
import { treeToSvg } from '../src/shared/notes/mindmap-svg'
import type { TreeNode } from '../src/shared/notes/schema'

const TREE: TreeNode = {
  title: '极限 <&> 引论',
  children: [
    { title: '定义', terms: ['极限', '收敛'], children: [{ title: 'ε-δ', children: [] }] },
    { title: '计算', children: [] }
  ]
}

describe('treeToSvg (M3.3 导图 SVG 导出, 2026-09-05)', () => {
  it('produces a standalone paper-white document with every node', () => {
    const svg = treeToSvg(TREE, [], '第五讲')
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg.match(/class="mindmap-node"/g)).toBeNull() // plain SVG: no CSS classes
    expect(svg.match(/<rect /g)?.length).toBe(4) // root + 定义 + ε-δ + 计算
    expect(svg).toContain('ε-δ')
  })

  it('escapes XML-significant characters in titles and the doc title', () => {
    const svg = treeToSvg(TREE, [], 'A & B <c>')
    expect(svg).toContain('<title>A &amp; B &lt;c&gt;</title>')
    // The long title wraps, so assert on the first line's escaped content.
    expect(svg).toContain('极限 &lt;&amp;&gt; 引')
    expect(svg).not.toContain('<&>')
  })

  it('renders term sub-lines and dashed cross-links with labels', () => {
    const svg = treeToSvg(TREE, [{ from: '极限', to: '计算', label: '前提' }], '第五讲')
    // The narrow node wraps the sub-line. 批3: 断行改成以词/禁则为单位后切点会移动，
    // 故断言性质（确实换行、内容不丢）而不是某一个具体切点。
    // 关系标签也用 11px，故取最后一处（子行在文档里靠后）。
    const sublineStart = svg.lastIndexOf('font-size="11"')
    const subline = svg.slice(sublineStart, svg.indexOf('</text>', sublineStart))
    expect(subline.match(/<tspan/g)?.length).toBeGreaterThan(1)
    expect(subline).toContain('极限')
    expect(subline).toContain('收敛')
    expect(svg).toContain('stroke-dasharray="5 4"')
    expect(svg).toContain('>前提</text>')
  })

  it('omits the label element when a link carries no label', () => {
    const svg = treeToSvg(TREE, [{ from: '极限', to: '计算' }], '第五讲')
    expect(svg).toContain('stroke-dasharray="5 4"')
    expect(svg).not.toContain('rx="9" fill="#f4f5fa" stroke="#dfe3ee"')
  })
})
