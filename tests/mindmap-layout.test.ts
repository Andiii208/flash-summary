import { describe, expect, it } from 'vitest'
import { computeMindMapLayout, LEVEL_WIDTH, NODE_HEIGHT, PADDING } from '../src/shared/notes/mindmap-layout'
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
})
