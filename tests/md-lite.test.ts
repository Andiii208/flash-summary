import { describe, expect, it } from 'vitest'
import { parseInline, parseMdLite } from '../src/shared/notes/md-lite'

describe('parseInline', () => {
  it('splits plain text, bold, and code spans', () => {
    const spans = parseInline('先 **加粗** 再 `code` 收尾')
    expect(spans).toEqual([
      { t: 'text', v: '先 ' },
      { t: 'bold', v: '加粗' },
      { t: 'text', v: ' 再 ' },
      { t: 'code', v: 'code' },
      { t: 'text', v: ' 收尾' }
    ])
  })

  it('plain text without markers collapses to one text span', () => {
    expect(parseInline('普通句子')).toEqual([{ t: 'text', v: '普通句子' }])
  })
})

// P29 (plan 2026-09-21): 荧光笔 ==高亮==。
describe('parseInline ==mark== (P29)', () => {
  it('parses a closed ==span== as a mark token', () => {
    expect(parseInline('重点是 ==随机试验== 的定义')).toEqual([
      { t: 'text', v: '重点是 ' },
      { t: 'mark', v: '随机试验' },
      { t: 'text', v: ' 的定义' }
    ])
  })

  it('an unclosed == stays literal text（与 $$ 同纪律：不吞内容）', () => {
    expect(parseInline('a == b')).toEqual([{ t: 'text', v: 'a == b' }])
    // 只有开头没有第二个 == 时不匹配，原样留文本
    expect(parseInline('== 只有开头')).toEqual([{ t: 'text', v: '== 只有开头' }])
  })

  it('two == in one line span greedily to the closer（与 ** 同行为）', () => {
    expect(parseInline('a == b 与 c == d')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'mark', v: ' b 与 c ' },
      { t: 'text', v: ' d' }
    ])
  })

  it('== inside inline math is not a mark（$ 分支先于 == 匹配）', () => {
    const spans = parseInline('$a == b$ 是公式')
    expect(spans.some((s) => s.t === 'math')).toBe(true)
    expect(spans.some((s) => s.t === 'mark')).toBe(false)
  })

  it('== inside code spans is not a mark（code 分支先于 == 匹配）', () => {
    const spans = parseInline('`a == b` 是代码')
    expect(spans.some((s) => s.t === 'code')).toBe(true)
    expect(spans.some((s) => s.t === 'mark')).toBe(false)
  })

  it('multiple marks in one line all parse', () => {
    const spans = parseInline('==甲== 和 ==乙==')
    expect(spans.filter((s) => s.t === 'mark').map((s) => (s as { v: string }).v)).toEqual(['甲', '乙'])
  })
})

describe('parseMdLite', () => {
  it('parses headings, bullet lists, ordered lists, quotes, paragraphs', () => {
    const blocks = parseMdLite(
      ['总起一句。', '', '## 本讲主线', '', '- 复杂度定义', '- 大O 记号', '', '1. 先化简', '2. 再代入', '', '> 老师原话'].join('\n')
    )
    expect(blocks).toEqual([
      { t: 'para', inline: [{ t: 'text', v: '总起一句。' }] },
      { t: 'heading', level: 2, inline: [{ t: 'text', v: '本讲主线' }] },
      {
        t: 'list',
        ordered: false,
        items: [
          [{ t: 'text', v: '复杂度定义' }],
          [{ t: 'text', v: '大O 记号' }]
        ]
      },
      {
        t: 'list',
        ordered: true,
        items: [
          [{ t: 'text', v: '先化简' }],
          [{ t: 'text', v: '再代入' }]
        ]
      },
      { t: 'quote', inline: [{ t: 'text', v: '老师原话' }] }
    ])
  })

  it('consecutive list lines stay in one list; a list never merges with a paragraph', () => {
    const blocks = parseMdLite('- A\n- B\n段落')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ t: 'list', ordered: false })
    expect(blocks[1]).toMatchObject({ t: 'para' })
  })

  it('bullet after ordered starts a fresh unordered list', () => {
    const blocks = parseMdLite('1. 甲\n- 乙')
    expect(blocks).toEqual([
      { t: 'list', ordered: true, items: [[{ t: 'text', v: '甲' }]] },
      { t: 'list', ordered: false, items: [[{ t: 'text', v: '乙' }]] }
    ])
  })

  it('CRLF input normalizes like LF', () => {
    expect(parseMdLite('A\r\n\r\n## H')).toEqual([
      { t: 'para', inline: [{ t: 'text', v: 'A' }] },
      { t: 'heading', level: 2, inline: [{ t: 'text', v: 'H' }] }
    ])
  })

  it('bold and code survive inside list items', () => {
    const blocks = parseMdLite('- **重点** 与 `符号`')
    expect(blocks[0]).toMatchObject({ t: 'list', ordered: false })
    const item = (blocks[0] as { items: Array<Array<{ t: string; v: string }>> }).items[0]!
    expect(item).toEqual([
      { t: 'bold', v: '重点' },
      { t: 'text', v: ' 与 ' },
      { t: 'code', v: '符号' }
    ])
  })
})
