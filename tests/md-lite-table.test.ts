import { describe, expect, it } from 'vitest'
import { parseMdLite } from '../src/shared/notes/md-lite'

/**
 * 2026-09-11（声明批3 收口）: md-lite 的表格支持。
 *
 * 起因是设置页「第三方许可」要渲染 THIRD-PARTY-NOTICES.md，而那份文件的骨架就是表格。
 * 表格是纯展示元素（不像链接能导航），所以补它不扩大安全面；顺带让模型偶尔输出的表格
 * 在笔记里也不再塌成一堆竖线。
 */
describe('md-lite 表格', () => {
  it('把 `| a | b |` + 分隔行 + 数据行解析成 table 块', () => {
    const blocks = parseMdLite(['| 项目 | 值 |', '| --- | --- |', '| 组件 | ffmpeg |', '| 许可 | GPL-3.0 |'].join('\n'))
    expect(blocks).toHaveLength(1)
    const table = blocks[0]
    expect(table.t).toBe('table')
    if (table.t !== 'table') return
    expect(table.header.map((cell) => cell[0]?.v)).toEqual(['项目', '值'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[1].map((cell) => cell[0]?.v)).toEqual(['许可', 'GPL-3.0'])
  })

  it('首尾竖线可省；单元格里的 **加粗** 与 `代码` 仍走行内解析', () => {
    const blocks = parseMdLite(['项目 | 值', '--- | ---', '许可 | **GPL-3.0** 与 `ffmpeg`'].join('\n'))
    const table = blocks[0]
    expect(table.t).toBe('table')
    if (table.t !== 'table') return
    const lastCell = table.rows[0][1]
    expect(lastCell.some((span) => span.t === 'bold' && span.v === 'GPL-3.0')).toBe(true)
    expect(lastCell.some((span) => span.t === 'code' && span.v === 'ffmpeg')).toBe(true)
  })

  it('表格前后是普通段落——别把整篇都吞进表格', () => {
    const blocks = parseMdLite(['前言。', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '后记。'].join('\n'))
    expect(blocks.map((b) => b.t)).toEqual(['para', 'table', 'para'])
  })

  it('只有表头没有数据行也能解析（清单未填满时不至于崩）', () => {
    const blocks = parseMdLite(['| a | b |', '| --- | --- |'].join('\n'))
    expect(blocks[0].t).toBe('table')
    if (blocks[0].t !== 'table') return
    expect(blocks[0].rows).toEqual([])
  })

  it('普通正文里的竖线不会被误判成表格（没有分隔行就不是表格）', () => {
    const blocks = parseMdLite('这一行有竖线 | 但它不是表格')
    expect(blocks.map((b) => b.t)).toEqual(['para'])
  })

  it('列表不会被表格抢走——分隔行只跟着「上一行是行」的情况', () => {
    const blocks = parseMdLite(['- 第一项', '- 第二项'].join('\n'))
    expect(blocks.map((b) => b.t)).toEqual(['list'])
  })
})
