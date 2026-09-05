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
