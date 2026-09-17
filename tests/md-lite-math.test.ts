/**
 * 批4 (plan 2026-09-17 note-quality upgrade) 单测：md-lite 的公式支持。
 *
 * `kind:'formula'` 字段一直存在，但此前只当纯文本渲染——`$...$` 与 `\frac`
 * 原样印出来。这批补上 token 与渲染（KaTeX 在渲染层，parser 仍只产 token）。
 */
import { describe, expect, it } from 'vitest'
import { parseInline, parseMdLite } from '../src/shared/notes/md-lite'

describe('parseInline 行内公式', () => {
  it('$...$ 变成 math span，tex 原样保留', () => {
    const spans = parseInline('面积为 $\\pi r^2$ ，注意单位')
    expect(spans).toEqual([
      { t: 'text', v: '面积为 ' },
      { t: 'math', v: '\\pi r^2' },
      { t: 'text', v: ' ，注意单位' }
    ])
  })

  it('单个字符的公式也认（$x$）', () => {
    expect(parseInline('变量 $x$ 的取值')).toEqual([
      { t: 'text', v: '变量 ' },
      { t: 'math', v: 'x' },
      { t: 'text', v: ' 的取值' }
    ])
  })

  it('货币符号不被误判为公式（定界符两侧不贴空格）', () => {
    expect(parseInline('这件商品花了 $5 和 $10 元')).toEqual([{ t: 'text', v: '这件商品花了 $5 和 $10 元' }])
  })

  it('公式与加粗/行内码混排互不干扰', () => {
    expect(parseInline('**重点** $a+b$ 与 `code`')).toEqual([
      { t: 'bold', v: '重点' },
      { t: 'text', v: ' ' },
      { t: 'math', v: 'a+b' },
      { t: 'text', v: ' 与 ' },
      { t: 'code', v: 'code' }
    ])
  })

  it('未闭合的 $ 保持普通文本（不吃掉后面的内容）', () => {
    expect(parseInline('成本是 $ 100 左右')).toEqual([{ t: 'text', v: '成本是 $ 100 左右' }])
  })
})

describe('parseMdLite 块级公式', () => {
  it('单行 $$...$$ 成为 math 块', () => {
    const blocks = parseMdLite('$$L = -\\sum_i y_i \\log p_i$$')
    expect(blocks).toEqual([{ t: 'math', tex: 'L = -\\sum_i y_i \\log p_i' }])
  })

  it('跨行 $$ 块被合并成一个 math 块，且不吞掉后续内容', () => {
    const blocks = parseMdLite('前置说明\n\n$$\n\\frac{a}{b}\n= c\n$$\n\n后置说明')
    expect(blocks[0]).toMatchObject({ t: 'para' })
    expect(blocks[1]).toEqual({ t: 'math', tex: '\\frac{a}{b}\n= c' })
    expect(blocks[2]).toMatchObject({ t: 'para' })
  })

  it('$$ 同行闭合后残留的文字另起一段（不丢）', () => {
    const blocks = parseMdLite('$$a=b$$ 这就是欧拉公式')
    expect(blocks[0]).toEqual({ t: 'math', tex: 'a=b' })
    expect(JSON.stringify(blocks[1])).toContain('这就是欧拉公式')
  })

  it('未闭合的 $$ 老实降级为普通段落，不吃掉后面整篇内容', () => {
    const blocks = parseMdLite('$$\\frac{a}{b}\n\n后面还有一整段正常内容，不能被吞掉。')
    const flat = JSON.stringify(blocks)
    expect(flat).toContain('后面还有一整段正常内容')
    expect(blocks.some((b) => b.t === 'math')).toBe(false)
  })

  it('公式不破坏既有的标题/列表/表格解析', () => {
    const blocks = parseMdLite('## 小节\n- 公式 $a$ 的说明\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(blocks.map((b) => b.t)).toEqual(['heading', 'list', 'table'])
  })
})
