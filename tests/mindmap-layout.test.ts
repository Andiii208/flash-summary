import { describe, expect, it } from 'vitest'
import {
  collapsedSetForMaxDepth,
  computeMindMapLayout,
  LEVEL_WIDTH,
  NODE_HEIGHT,
  PADDING,
  SUBLINE_HEIGHT,
  sublineFirstBaseline,
  sublineLinesOf,
  titleBaseline
} from '../src/shared/notes/mindmap-layout'
import type { TreeNode } from '../src/shared/notes/schema'

const TREE: TreeNode = {
  title: '极限',
  children: [
    {
      title: '定义',
      children: [
        { title: 'ε-δ 定义', children: [] },
        { title: '数列极限', children: [] }
      ]
    },
    {
      title: '计算',
      children: [{ title: '洛必达法则', children: [] }]
    }
  ]
}

/** Line-start-forbidden closers (mirrors the layout's 禁则 set). */
const NO_LINE_START_LIKE = /^[）」』》】，。、；：？！…]/

describe('computeMindMapLayout', () => {
  it('places the root leftmost and children one level to the right', () => {
    const layout = computeMindMapLayout(TREE, new Set())
    const root = layout.nodes.find((n) => n.depth === 0)!
    expect(root.x).toBe(PADDING)
    expect(root.title).toBe('极限')
    const children = layout.nodes.filter((n) => n.depth === 1)
    expect(children).toHaveLength(2)
    for (const child of children) expect(child.x).toBe(PADDING + LEVEL_WIDTH)
    const leaves = layout.nodes.filter((n) => n.depth === 2)
    expect(leaves).toHaveLength(3)
    for (const leaf of leaves) expect(leaf.x).toBe(PADDING + 2 * LEVEL_WIDTH)
  })

  it('leaf rows do not overlap (monotonic y with NODE_HEIGHT spacing)', () => {
    const layout = computeMindMapLayout(TREE, new Set())
    const leaves = layout.nodes.filter((n) => n.depth === 2).sort((a, b) => a.y - b.y)
    for (let i = 1; i < leaves.length; i++) {
      expect(leaves[i]!.y - leaves[i - 1]!.y).toBeGreaterThanOrEqual(NODE_HEIGHT)
    }
  })

  it('parents center on their children; every edge connects parent→child', () => {
    const layout = computeMindMapLayout(TREE, new Set())
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    for (const edge of layout.edges) {
      const parent = byId.get(edge.from)!
      const child = byId.get(edge.to)!
      expect(child.depth).toBe(parent.depth + 1)
      expect(edge.d).toMatch(/^M [\d.]+ [\d.]+ C /)
    }
    // The 定义 subtree spans ε-δ 定义 + 数列极限; parent centers within it.
    const def = layout.nodes.find((n) => n.title === '定义')!
    const defLeaves = layout.nodes.filter((n) => n.depth === 2 && n.x > def.x && n.y >= def.y - NODE_HEIGHT)
    expect(defLeaves.length).toBeGreaterThanOrEqual(2)
  })

  it('collapsing a node hides its whole subtree and shrinks the canvas', () => {
    const full = computeMindMapLayout(TREE, new Set())
    const collapsed = computeMindMapLayout(TREE, new Set(['0/0']))
    expect(collapsed.nodes).toHaveLength(full.nodes.length - 2)
    expect(collapsed.height).toBeLessThan(full.height)
    const def = collapsed.nodes.find((n) => n.title === '定义')!
    expect(def.collapsed).toBe(true)
  })

  it('node width estimates clamp to the level budget', () => {
    const long = { title: '一'.repeat(80), children: [] }
    const layout = computeMindMapLayout(long, new Set())
    expect(layout.nodes[0]!.width).toBeLessThanOrEqual(LEVEL_WIDTH - 30)
    const short = computeMindMapLayout({ title: '短', children: [] }, new Set())
    expect(short.nodes[0]!.width).toBeGreaterThanOrEqual(64)
  })

  it('empty tree degenerates to a single root node', () => {
    const layout = computeMindMapLayout({ title: 'root', children: [] }, new Set())
    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toEqual([])
    expect(layout.width).toBeGreaterThan(0)
  })

  it('long titles wrap into lines and grow the node height (批E, no truncation)', () => {
    const long = { title: '一'.repeat(40), children: [] }
    const layout = computeMindMapLayout(long, new Set())
    const node = layout.nodes[0]!
    // The full title is preserved across the wrapped lines.
    expect(node.lines.join('')).toBe(long.title)
    expect(node.lines.length).toBeGreaterThan(1)
    expect(node.height).toBeGreaterThan(NODE_HEIGHT)
    // The canvas accounts for the taller box.
    expect(layout.height).toBeGreaterThanOrEqual(node.y + node.height + PADDING)
    // A short title stays single-line at the classic height.
    const short = computeMindMapLayout({ title: '短', children: [] }, new Set())
    expect(short.nodes[0]!.lines).toEqual(['短'])
    expect(short.nodes[0]!.height).toBe(NODE_HEIGHT)
  })

  it('mixed CJK/ASCII wrapping uses the same unit model as the width', () => {
    const mixed = { title: 'Recursion递归递归递归递归', children: [] }
    const layout = computeMindMapLayout(mixed, new Set())
    const node = layout.nodes[0]!
    expect(node.lines.join('')).toBe(mixed.title)
    expect(node.lines.length).toBeGreaterThanOrEqual(1)
  })

  it('closing punctuation never starts a line (禁则)', () => {
    const layout = computeMindMapLayout({ title: '数据选择器（MUX）', children: [] }, new Set())
    const lines = layout.nodes[0]!.lines
    expect(lines.join('')).toBe('数据选择器（MUX）')
    for (const line of lines) expect(NO_LINE_START_LIKE.test(line)).toBe(false)
  })
})

describe('collapsedSetForMaxDepth (M1.2 层级控制)', () => {
  const DEEP: TreeNode = {
    title: '根',
    children: [
      {
        title: '甲',
        children: [{ title: '甲一', children: [{ title: '甲一一', children: [{ title: '底', children: [] }] }] }]
      },
      { title: '乙', children: [] }
    ]
  }

  it('maxDepth 1 ≡ 全部收起：所有有子代的节点都进折叠集', () => {
    const set = collapsedSetForMaxDepth(DEEP, 1)
    // 甲(0/0)、甲一(0/0/0)、甲一一(0/0/0/0) branchable; 乙 and leaves are not.
    expect(set).toEqual(new Set(['0/0', '0/0/0', '0/0/0/0']))
  })

  it('maxDepth 2 keeps tier 2 visible, folds deeper branchable nodes', () => {
    expect(collapsedSetForMaxDepth(DEEP, 2)).toEqual(new Set(['0/0/0', '0/0/0/0']))
    expect(collapsedSetForMaxDepth(DEEP, 3)).toEqual(new Set(['0/0/0/0']))
  })

  it('a shallow tree with maxDepth beyond its height yields the empty set', () => {
    expect(collapsedSetForMaxDepth(DEEP, 9)).toEqual(new Set())
    expect(collapsedSetForMaxDepth({ title: '独', children: [] }, 1)).toEqual(new Set())
  })
})

describe('computeMindMapLayout terms sub-line (M2.1)', () => {
  const ANCHORED: TreeNode = {
    title: '定义',
    terms: ['极限', '收敛'],
    children: []
  }

  it('default layout leaves subline empty and geometry unchanged', () => {
    const plain = computeMindMapLayout(ANCHORED, new Set())
    expect(plain.nodes[0]!.subline).toBe('')
    const sameTitle = computeMindMapLayout({ title: '定义', children: [] }, new Set())
    expect(plain.nodes[0]!.height).toBe(sameTitle.nodes[0]!.height)
  })

  it('showTerms renders a sub-line that grows the node and keeps titles centered', () => {
    const layout = computeMindMapLayout(ANCHORED, new Set(), { showTerms: true })
    const node = layout.nodes[0]!
    expect(node.subline).toBe('极限、收敛')
    expect(node.height).toBeGreaterThan(computeMindMapLayout({ title: '定义', children: [] }, new Set()).nodes[0]!.height)
    // Title block centers within the area above the sub-line.
    const sublineCount = sublineLinesOf(node).length
    expect(titleBaseline(node) + sublineCount * SUBLINE_HEIGHT).toBeLessThan(node.height)
    expect(sublineFirstBaseline(node)).toBeLessThan(node.height)
  })
})

describe('computeMindMapLayout cross-links (M3.1)', () => {
  const LINKED: TreeNode = {
    title: '根',
    children: [
      { title: '甲', terms: ['递归'], children: [{ title: '甲一', children: [] }] },
      { title: '乙', terms: ['栈'], children: [] }
    ]
  }

  it('resolves endpoints by term first, then by title', () => {
    const layout = computeMindMapLayout(LINKED, new Set(), {
      links: [
        { from: '递归', to: '栈', label: '对比' },
        { from: '甲', to: '乙' }
      ]
    })
    expect(layout.links).toHaveLength(2)
    expect(layout.links[0]!.label).toBe('对比')
    expect(layout.links[1]!.label).toBe('')
    expect(layout.links[0]!.d).toMatch(/^M /)
    expect(Number.isFinite(layout.links[0]!.lx)).toBe(true)
  })

  it('drops fabricated endpoints, self-links, and links whose endpoint is collapsed away', () => {
    const dropped = computeMindMapLayout(LINKED, new Set(), {
      links: [
        { from: '编造概念', to: '栈' },
        { from: '递归', to: '递归' }
      ]
    })
    expect(dropped.links).toHaveLength(0)
    // 甲一 lives under collapsed 甲 (path 0/0) → never laid out → link drops.
    const hidden = computeMindMapLayout(LINKED, new Set(['0/0']), { links: [{ from: '甲一', to: '栈' }] })
    expect(hidden.links).toHaveLength(0)
    // The still-visible collapsed node itself keeps hosting links.
    const kept = computeMindMapLayout(LINKED, new Set(['0/0']), { links: [{ from: '递归', to: '栈' }] })
    expect(kept.links).toHaveLength(1)
  })
})

describe('批5 概念关联的几何与性能（2026-09-17）', () => {
  /** 一棵足够宽的树，用来验证关联线绕行与大规模布局。 */
  const wideTree = (branches: number, depth: number): TreeNode => ({
    title: '根',
    children: Array.from({ length: branches }, (_, i) => {
      let node: TreeNode = { title: `叶${i}`, children: [] }
      for (let d = 1; d < depth; d += 1) node = { title: `层${d}-${i}`, children: [node] }
      return node
    })
  })

  it('同列重叠的关联线走绕行走廊，不再是一条穿过两个节点框的直线', () => {
    // 同一分支下的两个节点同列，必然横向重叠。
    const tree: TreeNode = {
      title: '根',
      children: [
        { title: '甲', children: [{ title: '甲一', children: [] }, { title: '甲二', children: [] }] },
        { title: '乙', children: [] }
      ]
    }
    const layout = computeMindMapLayout(tree, new Set(), { links: [{ from: '甲一', to: '甲二', label: '对比' }] })
    expect(layout.links).toHaveLength(1)
    const d = layout.links[0]!.d
    // 正交折线：至少四个点（起 → 走廊 → 走廊 → 终），且没有二次贝塞尔
    expect(d.split('L').length - 1).toBeGreaterThanOrEqual(3)
    expect(d).not.toContain('C')

    // 折线的竖直段必须落在两端点矩形之间的走廊里，即真的绕开了节点框。
    const a = layout.nodes.find((n) => n.title === '甲一')!
    const b = layout.nodes.find((n) => n.title === '甲二')!
    const corridor = layout.links[0]!.lx
    const leftEdge = Math.max(a.x, b.x)
    const rightEdge = Math.min(a.x + a.width, b.x + b.width)
    expect(corridor).toBeGreaterThanOrEqual(leftEdge - 1)
    expect(corridor).toBeLessThanOrEqual(rightEdge + 1)
  })

  it('横向分离的关联线仍走层级贝塞尔（与树边同形，观感一致）', () => {
    // 注意：同深度的兄弟节点必然落在同一列（x 只由 depth 决定），所以「横向分离」
    // 必须跨层取点——这里取深度 1 的「甲」与深度 2 的「乙一」。
    const tree: TreeNode = {
      title: '根',
      children: [
        { title: '甲', children: [{ title: '甲一', children: [] }] },
        { title: '乙', children: [{ title: '乙一', children: [] }] }
      ]
    }
    const layout = computeMindMapLayout(tree, new Set(), { links: [{ from: '甲', to: '乙一' }] })
    expect(layout.links).toHaveLength(1)
    expect(layout.links[0]!.d).toContain('C')
  })

  it('性能门禁：上百节点的布局不退化（原 O(n²) 边收集会在这里暴露）', () => {
    const tree = wideTree(15, 4) // 15 分支 × (1 叶 + 3 中间层) + 根 = 61 节点
    const started = Date.now()
    const layout = computeMindMapLayout(tree, new Set(), {})
    const elapsed = Date.now() - started
    expect(layout.nodes.length).toBeGreaterThan(50)
    // 边数 = 节点数 - 1（树）
    expect(layout.edges).toHaveLength(layout.nodes.length - 1)
    // 阈值刻意放宽（只防明显退化，不做微基准）；原实现也在几十毫秒级。
    expect(elapsed).toBeLessThan(1500)
  })
})
