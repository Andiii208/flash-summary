/**
 * 批5 (plan 2026-09-17 note-quality-upgrade item 2) 单测：概念关系图布局。
 *
 * 关系模式是「同一视图内的第二种呈现」——把 `conceptLinks` 当主结构画出来，
 * 而不再只是层级树上几条 ≤5 条的虚线。布局刻意做成**确定性**的（无迭代、无随机、
 * 无 d3），所以这里能把每条规则钉死。
 */
import { describe, expect, it } from 'vitest'
import { computeRelationLayout } from '../src/shared/notes/relation-layout'
import { parseNote, type Concept } from '../src/shared/notes/schema'

const concepts = (...terms: string[]): Concept[] => terms.map((term) => ({ term, definition: `${term} 的定义，够长即可。`, refs: [] }))

describe('computeRelationLayout 关系图布局', () => {
  it('空输入给出空图与最小画布（不炸、不画空框）', () => {
    const layout = computeRelationLayout([], [])
    expect(layout.nodes).toEqual([])
    expect(layout.edges).toEqual([])
    expect(layout.concepts).toBe(0)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('没有任何链接时：概念各自成孤立分量，全部可见（不是空图）', () => {
    const layout = computeRelationLayout(concepts('A', 'B', 'C'), [])
    expect(layout.nodes).toHaveLength(3)
    expect(layout.edges).toEqual([])
    // 三个单节点分量横向排开，互不重叠
    const centers = layout.nodes.map((n) => n.cx).sort((a, b) => a - b)
    expect(centers[1]! - centers[0]!).toBeGreaterThan(0)
    expect(centers[2]! - centers[1]!).toBeGreaterThan(0)
  })

  it('有链接的概念进同一分量，边被画出来且带关系词', () => {
    const layout = computeRelationLayout(concepts('学习率', '过拟合', '正则化'), [
      { from: '学习率', to: '过拟合', label: '因果' },
      { from: '正则化', to: '过拟合', label: '对比' }
    ])
    expect(layout.nodes).toHaveLength(3)
    expect(layout.edges).toHaveLength(2)
    // 顺序沿用链接在 notes.links 里的出现顺序（不重排）——因 < 对 只是码元巧合，
    // 这里断言的是「两条都画出来了」。
    // 断言「两条都画出来了」——默认 sort 按 UTF-16 码元比较，因(56E0) < 对(5BF9)。
    expect(layout.edges.map((e) => e.label).sort()).toEqual(['因果', '对比'])
  })

  it('**边数不再受 ≤5 条限制**——这正是关系模式要解决的问题', () => {
    const terms = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const links = terms.slice(1).map((term, i) => ({ from: terms[i]!, to: term, label: '包含' }))
    expect(links.length).toBeGreaterThan(5)
    const layout = computeRelationLayout(concepts(...terms), links)
    expect(layout.edges).toHaveLength(links.length)
  })

  it('解析不到的概念、自环、重复边一律不进图（二次防线）', () => {
    const layout = computeRelationLayout(concepts('A', 'B'), [
      { from: 'A', to: '不存在的概念', label: '前提' },
      { from: 'A', to: 'A', label: '自环' },
      { from: 'A', to: 'B', label: '对比' },
      { from: 'B', to: 'A', label: '对比' } // 无向去重：与上一条同一条
    ])
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0]!.label).toBe('对比')
  })

  it('边的端点被裁剪到盒边界——线段不穿过节点矩形内部', () => {
    const layout = computeRelationLayout(concepts('甲', '乙'), [{ from: '甲', to: '乙', label: '前提' }])
    const edge = layout.edges[0]!
    const [甲, 乙] = [layout.nodes.find((n) => n.term === '甲')!, layout.nodes.find((n) => n.term === '乙')!]
    const match = /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/.exec(edge.d)
    expect(match).not.toBeNull()
    const [, x1, y1, x2, y2] = match!.map(Number)
    // 起点必须在甲的盒边界上（x 或 y 贴着某条边，允许 3px 容差）
    const onBoxEdge = (x: number, y: number, box: typeof 甲): boolean =>
      Math.abs(x - box.x) <= 3 || Math.abs(x - (box.x + box.width)) <= 3 || Math.abs(y - box.y) <= 3 || Math.abs(y - (box.y + box.height)) <= 3
    expect(onBoxEdge(x1!, y1!, 甲)).toBe(true)
    expect(onBoxEdge(x2!, y2!, 乙)).toBe(true)
  })

  it('确定性：同样输入永远得到同样的图（可回归、截图稳定）', () => {
    const input = {
      concepts: concepts('学习率', '过拟合', '正则化', '批量大小'),
      links: [
        { from: '学习率', to: '过拟合', label: '因果' },
        { from: '正则化', to: '过拟合', label: '对比' },
        { from: '批量大小', to: '学习率', label: '前提' }
      ]
    }
    const first = computeRelationLayout(input.concepts, input.links)
    const second = computeRelationLayout(input.concepts, input.links)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    // 节点次序由数据决定（分量按大小、再按首 term）
    expect(first.nodes.map((n) => n.term)).toEqual(second.nodes.map((n) => n.term))
  })

  it('不改入参（纯函数）', () => {
    const input = concepts('A', 'B')
    const snapshot = JSON.stringify(input)
    computeRelationLayout(input, [{ from: 'A', to: 'B' }])
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('多分量：大的在前、互不重叠，画布容得下全部节点', () => {
    const layout = computeRelationLayout(concepts('a', 'b', 'c', 'x'), [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' }
    ])
    expect(layout.nodes).toHaveLength(4)
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width + 1)
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height + 1)
    }
  })

  it('长名词换行而不是被截断（沿用导图的文字度量，不另起一套）', () => {
    const long = '这是一个相当长的概念名称用来验证关系图节点会换行而不是被截断掉'
    const layout = computeRelationLayout(concepts(long, '短'), [])
    const node = layout.nodes.find((n) => n.term === long)!
    expect(node.lines.length).toBeGreaterThan(1)
    expect(node.lines.join('')).toBe(long)
  })

  it('经 parseNote 的真实笔记形状可直接喂进来', () => {
    const note = parseNote(
      JSON.stringify({
        overview: '概览'.repeat(80),
        knowledgeTree: { title: '根', children: [] },
        concepts: [
          { term: '学习率', definition: '步长参数，过大震荡过小慢，需配合调度器。'.repeat(3) },
          { term: '过拟合', definition: '训练精度高而测试精度低的现象，本质是容量过大。'.repeat(3) }
        ],
        methodology: 'm',
        conceptLinks: [{ from: '学习率', to: '过拟合', label: '因果' }]
      })
    )
    const layout = computeRelationLayout(note.concepts, note.conceptLinks)
    expect(layout.nodes).toHaveLength(2)
    expect(layout.edges).toHaveLength(1)
  })
})
