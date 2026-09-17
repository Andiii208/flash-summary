/**
 * 概念关系图布局（批5, plan 2026-09-17 note-quality-upgrade item 2）。
 *
 * 为什么需要它：导图视图的主结构是**层级树**，`conceptLinks` 只是树上几条虚线，
 * 而且 prompt 把链接数限死在 ≤5 条。用户看不出「本讲的概念之间是什么关系」——
 * 那正是知识结构里最该被看见的一层。
 *
 * 「关系模式」= 同一视图内的第二种呈现（**不新增第六视图**：spec §5 修订批注①
 * 把五视图钉死了，新增视图要先改 spec；模式切换是纯呈现层改动）。
 *
 * 布局刻意做成**确定性**的（无迭代、无随机、无 d3）：
 *   1. 按链接建联通分量，分量内概念构成一张小图；
 *   2. 每个分量把节点**按 term 排序后均匀排在一个圆上**（半径随节点数增长）；
 *   3. 分量之间从左到右排列，大的在前（次序确定：先按节点数降序，再按首 term）。
 * 于是同样的输入永远得到同样的图——可测、可回归、PDF/截图都稳定。
 *
 * 边按到盒边界裁剪后画直线；关系词作为标签放在中点（与导图视图的虚线标签同款）。
 */
import type { Concept, ConceptLink } from './schema'
import { LINE_HEIGHT, NODE_MAX_WIDTH, PADDING, nodeWidth, wrapTitleLines } from './mindmap-layout'

/** 关系图里的一个概念节点（盒中心为 x/y，便于圆上摆位）。 */
export interface RelationNode {
  id: number
  term: string
  lines: string[]
  /** 盒左上角。 */
  x: number
  y: number
  width: number
  height: number
  /** 盒中心。 */
  cx: number
  cy: number
}

/** 一条已解析的关系边（两端都是真实概念）。 */
export interface RelationEdge {
  fromId: number
  toId: number
  label: string
  /** 裁剪到盒边界后的直线路径。 */
  d: string
  /** 标签锚点（线段中点）。 */
  lx: number
  ly: number
}

export interface RelationLayout {
  nodes: RelationNode[]
  edges: RelationEdge[]
  width: number
  height: number
  /** 被画出的概念数（= nodes.length），供调用方判断是否为空图。 */
  concepts: number
}

const NODE_PAD_X = 12
const NODE_MIN_WIDTH = 96
/** 分量间距与圆的最小半径。 */
const COMPONENT_GAP = 56
const MIN_RADIUS = 78
/** 每个节点沿圆周让出的弧长——节点越多圆越大，避免挤在一起。 */
const ARC_PER_NODE = 62

/** 盒中心 + 半宽半高 → 沿 (dx,dy) 方向射出时与盒边界的交点（射线–矩形求交）。 */
function clipToBox(from: RelationNode, to: RelationNode): { x: number; y: number } {
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy
  if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy }
  const halfW = from.width / 2 + 2
  const halfH = from.height / 2 + 2
  // 参数 t：射线走多远会撞上盒的某条边
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx)
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy)
  const t = Math.min(tx, ty)
  return { x: from.cx + dx * t, y: from.cy + dy * t }
}

/** 只保留两端都能解析到 concept 的链接（归一层已过滤一次，这里是二次防线）。 */
function resolveEdges(concepts: Concept[], links: ConceptLink[]): Array<{ from: string; to: string; label: string }> {
  const known = new Set(concepts.map((c) => c.term))
  const seen = new Set<string>()
  const resolved: Array<{ from: string; to: string; label: string }> = []
  for (const link of links) {
    if (!known.has(link.from) || !known.has(link.to) || link.from === link.to) continue
    // 无向去重：A→B 与 B→A 是同一层关系，只画一次（先出现的胜出）。
    const key = [link.from, link.to].sort().join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push({ from: link.from, to: link.to, label: (link.label ?? '').trim() })
  }
  return resolved
}

/** 联通分量：按「首次出现顺序」收集，保证确定性。 */
function componentsOf(terms: string[], edges: Array<{ from: string; to: string }>): string[][] {
  const adjacency = new Map<string, string[]>()
  for (const term of terms) adjacency.set(term, [])
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to)
    adjacency.get(edge.to)?.push(edge.from)
  }
  const visited = new Set<string>()
  const components: string[][] = []
  for (const term of terms) {
    if (visited.has(term)) continue
    const stack = [term]
    const group: string[] = []
    visited.add(term)
    while (stack.length > 0) {
      const current = stack.pop() as string
      group.push(current)
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        stack.push(next)
      }
    }
    components.push(group)
  }
  return components
}

export function computeRelationLayout(concepts: Concept[], links: ConceptLink[]): RelationLayout {
  const terms = concepts.map((c) => c.term)
  const resolved = resolveEdges(concepts, links)
  const components = componentsOf(terms, resolved)
    // 大的分量在前；同大小按首 term 排序——次序完全由数据决定。
    .map((group) => [...group].sort())
    .sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!))

  const boxes = new Map<string, { width: number; height: number; lines: string[] }>()
  for (const concept of concepts) {
    const width = Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, nodeWidth(concept.term)))
    const lines = wrapTitleLines(concept.term, width - NODE_PAD_X * 2)
    boxes.set(concept.term, { width, height: Math.max(LINE_HEIGHT + 14, lines.length * LINE_HEIGHT + 14), lines })
  }

  const nodes: RelationNode[] = []
  const byTerm = new Map<string, RelationNode>()
  let offsetX = PADDING
  let maxHeight = 0
  let nextId = 1

  for (const group of components) {
    const radius = group.length <= 1 ? 0 : Math.max(MIN_RADIUS, (group.length * ARC_PER_NODE) / (2 * Math.PI))
    const groupWidth = radius * 2 + NODE_MAX_WIDTH
    const groupHeight = radius * 2 + LINE_HEIGHT * 3
    const cx = offsetX + groupWidth / 2
    const cy = PADDING + groupHeight / 2
    group.forEach((term, index) => {
      const box = boxes.get(term) as { width: number; height: number; lines: string[] }
      // 单节点分量直接居中；否则沿圆周均匀分布（从正上方开始，顺时针）。
      const angle = group.length <= 1 ? 0 : (index / group.length) * Math.PI * 2 - Math.PI / 2
      const centerX = group.length <= 1 ? cx : cx + Math.cos(angle) * radius
      const centerY = group.length <= 1 ? cy : cy + Math.sin(angle) * radius
      const node: RelationNode = {
        id: nextId++,
        term,
        lines: box.lines,
        width: box.width,
        height: box.height,
        cx: centerX,
        cy: centerY,
        x: centerX - box.width / 2,
        y: centerY - box.height / 2
      }
      nodes.push(node)
      byTerm.set(term, node)
    })
    offsetX += groupWidth + COMPONENT_GAP
    maxHeight = Math.max(maxHeight, groupHeight)
  }

  const edges: RelationEdge[] = []
  for (const edge of resolved) {
    const from = byTerm.get(edge.from)
    const to = byTerm.get(edge.to)
    if (from == null || to == null) continue
    const start = clipToBox(from, to)
    const end = clipToBox(to, from)
    edges.push({
      fromId: from.id,
      toId: to.id,
      label: edge.label,
      d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      lx: (start.x + end.x) / 2,
      ly: (start.y + end.y) / 2
    })
  }

  return {
    nodes,
    edges,
    width: nodes.length === 0 ? PADDING * 2 : offsetX - COMPONENT_GAP + PADDING,
    height: nodes.length === 0 ? PADDING * 2 : maxHeight + PADDING * 2,
    concepts: nodes.length
  }
}
