/**
 * Mind-map layout (2026-09-04 笔记工艺): pure function turning the note's
 * knowledgeTree into positioned nodes + bezier edges for a rightward
 * («root on the left») SVG render. No dependencies, deterministic.
 */
import type { TreeNode } from './schema'

export const NODE_HEIGHT = 40
export const NODE_GAP = 14
export const LEVEL_WIDTH = 230
export const PADDING = 24
export const NODE_MAX_WIDTH = LEVEL_WIDTH - 30

export interface LayoutNode {
  id: number
  /** Tree path of node indices, stable across renders. */
  path: string
  title: string
  depth: number
  /** Top-left of the node box. */
  x: number
  y: number
  width: number
  hasChildren: boolean
  collapsed: boolean
}

export interface LayoutEdge {
  from: number
  to: number
  /** Bezier control points between the two node centers' right/left ports. */
  d: string
}

export interface MindMapLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
}

/** Estimate a node's box width from its title length (CJK ≈ full width). */
function nodeWidth(title: string): number {
  const units = [...title].reduce((acc, ch) => acc + (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0)
  return Math.min(NODE_MAX_WIDTH, Math.max(64, Math.round(units * 13 + 24)))
}

interface TreeSlice {
  node: LayoutNode
  children: TreeSlice[]
}

/** Build the layout for the tree with the given collapsed path set. */
export function computeMindMapLayout(root: TreeNode, collapsed: ReadonlySet<string>): MindMapLayout {
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  let nextId = 0

  const measure = (node: TreeNode, depth: number, path: string): TreeSlice => {
    const id = nextId++
    const isCollapsed = collapsed.has(path)
    const layout: LayoutNode = {
      id,
      path,
      title: node.title,
      depth,
      x: 0,
      y: 0,
      width: nodeWidth(node.title),
      hasChildren: node.children.length > 0,
      collapsed: isCollapsed
    }
    nodes.push(layout)
    const children = isCollapsed ? [] : node.children.map((child, i) => measure(child, depth + 1, `${path}/${i}`))
    return { node: layout, children }
  }

  const slice = measure(root, 0, '0')

  // Assign y top-down: leaves stack by rows, parents center on their children.
  let cursorY = PADDING
  const place = (sliceNode: TreeSlice): { top: number; bottom: number } => {
    if (sliceNode.children.length === 0) {
      sliceNode.node.y = cursorY
      cursorY += NODE_HEIGHT
      return { top: sliceNode.node.y, bottom: sliceNode.node.y + NODE_HEIGHT }
    }
    const childTops: Array<{ top: number; bottom: number }> = []
    for (const child of sliceNode.children) childTops.push(place(child))
    const first = childTops[0]!
    const last = childTops[childTops.length - 1]!
    sliceNode.node.y = (first.top + last.bottom) / 2 - NODE_HEIGHT / 2
    // Children stacked with gaps; ensure the parent never overlaps a child.
    cursorY += NODE_GAP
    return { top: Math.min(sliceNode.node.y, first.top), bottom: Math.max(sliceNode.node.y + NODE_HEIGHT, last.bottom) }
  }
  place(slice)

  // Assign x left-to-right by depth; collect bezier edges.
  for (const node of nodes) node.x = PADDING + node.depth * LEVEL_WIDTH
  for (const parent of nodes) {
    const children = nodes.filter((n) => n.path.startsWith(`${parent.path}/`) && n.path.split('/').length === parent.path.split('/').length + 1)
    for (const child of children) edges.push({ from: parent.id, to: child.id, d: edgePath(parent, child) })
  }

  const width = Math.max(...nodes.map((n) => n.x + n.width)) + PADDING
  const height = Math.max(...nodes.map((n) => n.y + NODE_HEIGHT)) + PADDING
  return { nodes, edges, width, height }
}

function edgePath(parent: LayoutNode, child: LayoutNode): string {
  const x1 = parent.x + parent.width
  const y1 = parent.y + NODE_HEIGHT / 2
  const x2 = child.x
  const y2 = child.y + NODE_HEIGHT / 2
  const mid = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}
