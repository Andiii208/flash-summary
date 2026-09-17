/**
 * Mind-map layout (2026-09-04 笔记工艺): pure function turning the note's
 * knowledgeTree into positioned nodes + bezier edges for a rightward
 * («root on the left») SVG render. No dependencies, deterministic.
 */
import type { TreeNode } from './schema'

export const NODE_HEIGHT = 40
/** 批E: per-line advance and vertical padding for multi-line node titles. */
export const LINE_HEIGHT = 18
const TEXT_PAD_Y = 12
/** Character unit width used by both nodeWidth and wrapTitleLines (CJK = 1). */
const CHAR_UNIT_W = 13
export const NODE_GAP = 14
export const LEVEL_WIDTH = 230
export const PADDING = 24
export const NODE_MAX_WIDTH = LEVEL_WIDTH - 30
/** M2.1: per-line advance of the concept-terms sub-line inside a node. */
export const SUBLINE_HEIGHT = 14

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
  /** 批E: per-node height — grows with wrapped line count (min NODE_HEIGHT). */
  height: number
  /** 批E: the title wrapped into lines the renderer prints verbatim (no ellipsis). */
  lines: string[]
  /** M2.1: anchored concept terms joined for a small sub-line ('' = none). */
  subline: string
  hasChildren: boolean
  collapsed: boolean
}

/** M3.1: input shape of a cross-link (structural — no schema coupling). */
export interface MindMapLinkInput {
  from: string
  to: string
  label?: string
}

/** M3.1: a resolved cross-link rendered as a dashed connector + label. */
export interface LayoutLink {
  fromId: number
  toId: number
  label: string
  d: string
  /** Label anchor (midpoint of the connector). */
  lx: number
  ly: number
}

/** M2.1: optional layout behaviour — sub-line only when explicitly enabled. */
export interface MindMapLayoutOptions {
  showTerms?: boolean
  /** M3.1: cross-links resolved against node terms/titles; unresolvable or
   *  collapsed-endpoint links are dropped (never rendered dangling). */
  links?: MindMapLinkInput[]
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
  /** M3.1: resolvable cross-links between VISIBLE nodes only. */
  links: LayoutLink[]
  width: number
  height: number
}

function isWideChar(ch: string): boolean {
  return /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)
}

/** Estimate a node's box width from its title length (CJK ≈ full width). */
function nodeWidth(title: string): number {
  const units = [...title].reduce((acc, ch) => acc + (isWideChar(ch) ? 1 : 0.55), 0)
  return Math.min(NODE_MAX_WIDTH, Math.max(64, Math.round(units * CHAR_UNIT_W + 24)))
}

/** 行首禁则：这些标点不许单独落行首，换行时挂在上一行行尾（略微超宽可接受）。 */
const NO_LINE_START = new Set([...'）」』》】，。、；：？！…'])

/**
 * 批E: wrap a title into the lines that fit the box width. Pure and
 * deterministic; the layout uses its length for the node height and the
 * renderers print the lines verbatim — long titles are never truncated.
 */
export function wrapTitleLines(title: string, boxWidth: number): string[] {
  const usable = Math.max(1, Math.floor((boxWidth - 24) / CHAR_UNIT_W))
  const lines: string[] = []
  let current = ''
  let currentUnits = 0
  for (const ch of [...title]) {
    const unit = isWideChar(ch) ? 1 : 0.55
    // 禁则字符跟紧前一行行尾，不单独成行首。
    if (NO_LINE_START.has(ch) && current !== '') {
      current += ch
      continue
    }
    if (currentUnits + unit > usable && current !== '') {
      lines.push(current)
      current = ch
      currentUnits = unit
    } else {
      current += ch
      currentUnits += unit
    }
  }
  if (current !== '') lines.push(current)
  return lines.length > 0 ? lines : ['']
}

/** Node box height for the wrapped lines (single line keeps NODE_HEIGHT). */
function nodeHeight(lines: string[], sublineLines: number): number {
  const base = Math.max(NODE_HEIGHT, lines.length * LINE_HEIGHT + TEXT_PAD_Y)
  return base + sublineLines * SUBLINE_HEIGHT
}

/** Baseline of the first text line inside a box of the given height. */
export function firstLineBaseline(nodeHeightPx: number, lineCount: number): number {
  return (nodeHeightPx - lineCount * LINE_HEIGHT) / 2 + 13
}

/** Wrapped lines of a node's sub-line (empty when the node has no terms). */
export function sublineLinesOf(node: Pick<LayoutNode, 'subline' | 'width'>): string[] {
  return node.subline === '' ? [] : wrapTitleLines(node.subline, node.width)
}

/** Baseline of the title text inside a laid-out node (subline-aware). */
export function titleBaseline(node: Pick<LayoutNode, 'height' | 'lines' | 'subline' | 'width'>): number {
  const sublineHeight = sublineLinesOf(node).length * SUBLINE_HEIGHT
  return firstLineBaseline(node.height - sublineHeight, node.lines.length)
}

/** Baseline of the FIRST sub-line (terms block sits at the node's bottom). */
export function sublineFirstBaseline(node: Pick<LayoutNode, 'height' | 'subline' | 'width'>): number {
  const lines = sublineLinesOf(node)
  if (lines.length === 0) return 0
  return node.height - (lines.length - 1) * SUBLINE_HEIGHT - 6
}

interface TreeSlice {
  node: LayoutNode
  children: TreeSlice[]
}

/** Build the layout for the tree with the given collapsed path set. */
export function computeMindMapLayout(root: TreeNode, collapsed: ReadonlySet<string>, options: MindMapLayoutOptions = {}): MindMapLayout {
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  let nextId = 0
  // M3.1: first-match endpoint indexes over the whole tree (visibility is
  // applied later — a collapsed endpoint drops the link entirely).
  const termIndex = new Map<string, string>()
  const titleIndex = new Map<string, string>()

  const measure = (node: TreeNode, depth: number, path: string): TreeSlice => {
    const id = nextId++
    const isCollapsed = collapsed.has(path)
    const width = nodeWidth(node.title)
    const lines = wrapTitleLines(node.title, width)
    // M2.1: terms render as a small sub-line only when opted in (PDF); the
    // screen map shows them in the popover instead, keeping geometry stable.
    const subline = options.showTerms === true && node.terms != null && node.terms.length > 0 ? node.terms.join('、') : ''
    const layout: LayoutNode = {
      id,
      path,
      title: node.title,
      depth,
      x: 0,
      y: 0,
      width,
      height: nodeHeight(lines, sublineLinesOf({ subline, width }).length),
      lines,
      subline,
      hasChildren: node.children.length > 0,
      collapsed: isCollapsed
    }
    nodes.push(layout)
    if (!titleIndex.has(node.title)) titleIndex.set(node.title, path)
    if (node.terms != null) for (const term of node.terms) if (!termIndex.has(term)) termIndex.set(term, path)
    const children = isCollapsed ? [] : node.children.map((child, i) => measure(child, depth + 1, `${path}/${i}`))
    return { node: layout, children }
  }

  const slice = measure(root, 0, '0')

  // Assign y top-down: leaves stack by rows, parents center on their children.
  let cursorY = PADDING
  const place = (sliceNode: TreeSlice): { top: number; bottom: number } => {
    const boxHeight = sliceNode.node.height
    if (sliceNode.children.length === 0) {
      sliceNode.node.y = cursorY
      cursorY += boxHeight
      return { top: sliceNode.node.y, bottom: sliceNode.node.y + boxHeight }
    }
    const childTops: Array<{ top: number; bottom: number }> = []
    for (const child of sliceNode.children) childTops.push(place(child))
    const first = childTops[0]!
    const last = childTops[childTops.length - 1]!
    sliceNode.node.y = (first.top + last.bottom) / 2 - boxHeight / 2
    // Children stacked with gaps; ensure the parent never overlaps a child.
    cursorY += NODE_GAP
    return { top: Math.min(sliceNode.node.y, first.top), bottom: Math.max(sliceNode.node.y + boxHeight, last.bottom) }
  }
  place(slice)

  // Assign x left-to-right by depth; collect bezier edges.
  for (const node of nodes) node.x = PADDING + node.depth * LEVEL_WIDTH
  // 批5: 边收集从 O(n²) 改成按父路径索引一次。原实现对每个节点都全量 `nodes.filter`
  // 并逐段比 path，课程级导图（几十课时合并、上百节点）会明显吃 CPU；实测没有基准
  // 测试兜底，所以顺手补上（见 tests/mindmap-layout.test.ts 的性能门禁）。
  const childEdges = new Map<string, LayoutNode[]>()
  for (const node of nodes) {
    const cut = node.path.lastIndexOf('/')
    if (cut < 0) continue // 根节点没有父
    const parentPath = node.path.slice(0, cut)
    const bucket = childEdges.get(parentPath)
    if (bucket == null) childEdges.set(parentPath, [node])
    else bucket.push(node)
  }
  for (const parent of nodes) {
    for (const child of childEdges.get(parent.path) ?? []) {
      edges.push({ from: parent.id, to: child.id, d: edgePath(parent, child) })
    }
  }

  // M3.1: resolve cross-links — term first, then title, first match wins.
  // A link whose endpoint node is not laid out (collapsed away) is dropped.
  const byPath = new Map(nodes.map((node) => [node.path, node]))
  const links: LayoutLink[] = []
  for (const link of options.links ?? []) {
    const fromPath = termIndex.get(link.from) ?? titleIndex.get(link.from)
    const toPath = termIndex.get(link.to) ?? titleIndex.get(link.to)
    if (fromPath == null || toPath == null || fromPath === toPath) continue
    const from = byPath.get(fromPath)
    const to = byPath.get(toPath)
    if (from == null || to == null) continue
    const path = linkPath(from, to)
    links.push({ fromId: from.id, toId: to.id, label: link.label ?? '', d: path.d, lx: path.lx, ly: path.ly })
  }

  const width = Math.max(...nodes.map((n) => n.x + n.width)) + PADDING
  const height = Math.max(...nodes.map((n) => n.y + n.height)) + PADDING
  return { nodes, edges, links, width, height }
}

/** M3.1: dashed connector between two sibling-independent node boxes plus
 *  its label anchor. Horizontally separated boxes use the hierarchical
 *  bezier shape; overlapping columns fall back to a center-to-center line. */
/**
 * M3.1 + 批5: dashed connector between two node boxes plus its label anchor.
 *
 * 两种情形：
 *   - **横向分离**（分属不同列）：走层级贝塞尔，与树边同形，观感一致。
 *   - **同列或重叠**（x 区间相交）：此前直接画一条中心到中心的**直线**——
 *     而这条直线必然从两个节点框内部穿过去（重叠定义即如此），课程级导图里
 *     看起来很脏。批5 改为**绕行侧廊道的正交折线**：从两端框的左右侧边出发，
 *     在两者之间走一条竖走廊再拐回，绕开节点矩形。
 *
 * 只保证不穿**端点**矩形（无法保证不穿中间无关节点——那需要全局路由，成本远超
 * 收益）；对「同列相邻两节点」这个实际最常见的重叠形态，绕行已经完全够用。
 */
function linkPath(a: LayoutNode, b: LayoutNode): { d: string; lx: number; ly: number } {
  const aRight = a.x + a.width
  const bRight = b.x + b.width
  if (aRight <= b.x || bRight <= a.x) {
    const [left, right] = aRight <= b.x ? [a, b] : [b, a]
    const d = edgePath(left, right)
    return { d, lx: (left.x + left.width + right.x) / 2, ly: (left.y + left.height / 2 + right.y + right.height / 2) / 2 }
  }
  // 重叠：挑一条落在两者之间的竖走廊，从各自较近的侧边走。
  const leftBox = a.x <= b.x ? a : b
  const rightBox = a.x <= b.x ? b : a
  const corridor = leftBox.x + leftBox.width + (rightBox.x - (leftBox.x + leftBox.width)) / 2
  const fromY = a.y + a.height / 2
  const toY = b.y + b.height / 2
  const fromX = corridor <= a.x + a.width / 2 ? a.x : a.x + a.width
  const toX = corridor <= b.x + b.width / 2 ? b.x : b.x + b.width
  const d =
    `M ${fromX} ${fromY}` +
    ` L ${corridor} ${fromY}` +
    ` L ${corridor} ${toY}` +
    ` L ${toX} ${toY}`
  return { d, lx: corridor, ly: (fromY + toY) / 2 }
}

function edgePath(parent: LayoutNode, child: LayoutNode): string {
  const x1 = parent.x + parent.width
  const y1 = parent.y + parent.height / 2
  const x2 = child.x
  const y2 = child.y + child.height / 2
  const mid = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

/**
 * M1.2 (map expansion): collapse set that keeps the map expanded down to
 * `maxDepth` levels — every branchable node at depth ≥ maxDepth is folded.
 * maxDepth 1 ≡ «collapse all» (only the first tier shows); an empty set
 * (maxDepth ≥ tree height) ≡ «expand all».
 */
export function collapsedSetForMaxDepth(root: TreeNode, maxDepth: number): Set<string> {
  const collapsed = new Set<string>()
  const walk = (node: TreeNode, depth: number, path: string): void => {
    if (depth >= maxDepth && node.children.length > 0) collapsed.add(path)
    node.children.forEach((child, i) => walk(child, depth + 1, `${path}/${i}`))
  }
  walk(root, 0, '0')
  return collapsed
}
