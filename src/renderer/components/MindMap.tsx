import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { TreeNode } from '../../shared/notes/schema'
import { collapsedSetForMaxDepth, computeMindMapLayout, firstLineBaseline } from '../../shared/notes/mindmap-layout'

/**
 * Interactive SVG mind map over the note's knowledgeTree (2026-09-04).
 * Nodes with children collapse on click; the layout is a pure shared
 * function so the PDF handout reuses the same geometry.
 *
 * 批D (2026-09-05): a dedicated caret (▸/▾) sits on the branch direction
 * with a folded-descendant count pill; collapsing glides via FLIP instead
 * of re-rendering in place; depth tiers get distinct fills/strokes.
 *
 * M1.2 (map expansion 2026-09-05): an in-view toolbar adds depth-level
 * controls (collapse set = pure shared function) and a title search that
 * highlights hits, dims the rest, unfolds hit ancestors and scrolls the
 * first hit into view.
 */
export function MindMap({ tree }: { tree: TreeNode }): JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const layout = useMemo(() => computeMindMapLayout(tree, collapsed), [tree, collapsed])
  const rootRef = useRef<SVGSVGElement>(null)
  /** FLIP bookkeeping: previous y per node path (x is depth-fixed). */
  const prevYRef = useRef<Map<string, number>>(new Map())

  const toggle = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // M1.2: search matches over the WHOLE tree — hits inside folded branches
  // become visible because the effect below unfolds their ancestors.
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const hits = new Set<string>()
    if (needle !== '') {
      const walk = (node: TreeNode, path: string): void => {
        if (node.title.toLowerCase().includes(needle)) hits.add(path)
        node.children.forEach((child, i) => walk(child, `${path}/${i}`))
      }
      walk(tree, '0')
    }
    return hits
  }, [tree, query])

  // M1.2: unfold every ancestor of a hit (write-back into the collapse set;
  // no snapshot restore — the simpler trade-off recorded in the plan).
  useLayoutEffect(() => {
    if (matched.size === 0) return
    setCollapsed((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const hitPath of matched) {
        const segments = hitPath.split('/')
        for (let end = 1; end < segments.length; end++) {
          if (next.delete(segments.slice(0, end).join('/'))) changed = true
        }
      }
      return changed ? next : prev
    })
  }, [matched])

  // M1.2: keep the first hit in view after each re-layout while searching.
  useEffect(() => {
    if (matched.size === 0) return
    const first = matched.values().next().value
    if (first == null) return
    const el = scrollRef.current?.querySelector(`[data-path="${first}"]`)
    if (el != null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [layout, matched])

  // 批D FLIP: after each re-layout, every surviving node starts from its
  // previous y (no transition), then CSS-transitions to the new position.
  useLayoutEffect(() => {
    const prevY = prevYRef.current
    const root = rootRef.current
    const nextY = new Map<string, number>()
    if (root != null) {
      for (const g of Array.from(root.querySelectorAll<SVGGElement>('.mindmap-node'))) {
        const path = g.dataset.path ?? ''
        const y = Number(g.dataset.y)
        nextY.set(path, y)
        const oldY = prevY.get(path)
        if (oldY == null || oldY === y) continue
        const x = Number(g.dataset.x)
        g.style.transition = 'none'
        g.style.transform = `translate(${x}px, ${oldY}px)`
        // Force a style flush so the snap-back actually animates.
        void g.getBoundingClientRect()
        g.style.transition = ''
        g.style.transform = `translate(${x}px, ${y}px)`
      }
    }
    prevYRef.current = nextY
  }, [layout])

  const depthById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n.depth])), [layout])

  /** Keyboard collapse/expand for a node with children (批D: parameterized). */
  const keyToggler = (path: string) => (e: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle(path)
    }
  }

  const searching = matched.size > 0

  return (
    <div class="mindmap-wrap" data-testid="mindmap">
      {/* M1.2: in-view toolbar (决策点 D1) — depth controls + search. */}
      <div class="mindmap-toolbar" data-testid="mindmap-toolbar">
        <button class="btn small" onClick={() => setCollapsed(collapsedSetForMaxDepth(tree, 1))}>
          全部收起
        </button>
        <button class="btn small" onClick={() => setCollapsed(collapsedSetForMaxDepth(tree, 2))}>
          展开 L2
        </button>
        <button class="btn small" onClick={() => setCollapsed(collapsedSetForMaxDepth(tree, 3))}>
          展开 L3
        </button>
        <button class="btn small" onClick={() => setCollapsed(new Set())}>
          全部展开
        </button>
        <span class="mindmap-toolbar-spacer" aria-hidden="true" />
        <input
          class="mindmap-search"
          type="search"
          placeholder="搜索节点…"
          aria-label="搜索节点"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="mindmap-scroll" ref={scrollRef}>
      <svg
        ref={rootRef}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`知识导图：${tree.title}`}
      >
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from}-${edge.to}`}
            d={edge.d}
            style={`d: path('${edge.d}')`}
            class={`mindmap-edge edge-d${depthById.get(edge.to) ?? 1}`}
            fill="none"
          />
        ))}
        {layout.nodes.map((node) => {
          const isRoot = node.depth === 0
          const hasChildren = node.hasChildren
          const descendants = hasChildren ? childCount(tree, node.path) : 0
          const pillWidth = Math.max(16, String(descendants).length * 8 + 10)
          const isHit = searching && matched.has(node.path)
          const searchClass = isHit ? ' search-hit' : searching ? ' search-dim' : ''
          return (
            <g
              key={node.id}
              class={`mindmap-node depth-${node.depth}${isRoot ? ' root' : ''}${node.collapsed ? ' collapsed' : ''}${searchClass}`}
              style={`transform: translate(${node.x}px, ${node.y}px)`}
              data-path={node.path}
              data-x={node.x}
              data-y={node.y}
              onClick={hasChildren ? () => toggle(node.path) : undefined}
              onKeyDown={hasChildren ? keyToggler(node.path) : undefined}
              tabIndex={hasChildren ? 0 : undefined}
              role={hasChildren ? 'button' : undefined}
              aria-expanded={hasChildren ? !node.collapsed : undefined}
              aria-label={hasChildren ? `${node.title}（点击${node.collapsed ? '展开' : '折叠'}）` : node.title}
            >
              <rect width={node.width} height={node.height} rx={8} class="mindmap-box" />
              {/* 批E: wrapped tspans — long titles are fully shown, no ellipsis. */}
              <text x={12} y={firstLineBaseline(node.height, node.lines.length)} class="mindmap-label">
                {node.lines.map((line, i) => (
                  <tspan key={i} x={12} dy={i === 0 ? 0 : 18}>
                    {line}
                  </tspan>
                ))}
              </text>
              {/* 批D: caret on the branch direction (+ count pill when folded).
                  The whole node stays clickable; the circle pads the hot zone. */}
              {hasChildren && (
                <g class={`mindmap-caret${node.collapsed ? ' collapsed' : ''}`} transform={`translate(${node.width + 8}, ${node.height / 2})`} aria-hidden="true">
                  <circle r={11} class="caret-hit" />
                  {node.collapsed ? <path d="M -3 -5 L 5 0 L -3 5 Z" class="caret-tri" /> : <path d="M -5 -3 L 0 5 L 5 -3 Z" class="caret-tri" />}
                  {node.collapsed && <rect x={9} y={-9} width={pillWidth} height={18} rx={9} class="caret-count-box" />}
                  {node.collapsed && (
                    <text x={9 + pillWidth / 2} y={3.5} text-anchor="middle" class="caret-count">
                      {descendants}
                    </text>
                  )}
                </g>
              )}
            </g>
          )
        })}
      </svg>
      </div>
    </div>
  )
}

/**
 * How many descendant titles live under a collapsed path (shown on the pill).
 * 修（批D 测试揪出）：路径首段是根自身的索引，不是下钻步骤；旧实现多走一层
 * 且按叶数-1 计，中间层节点显示错值——改为按后代节点总数计。
 */
function childCount(tree: TreeNode, path: string): number {
  let node: TreeNode | null = tree
  for (const step of path.split('/').slice(1)) {
    if (node == null) return 0
    node = node.children[Number(step)] ?? null
  }
  return node != null ? countDescendants(node) - 1 : 0
}

function countDescendants(node: TreeNode): number {
  return 1 + node.children.reduce((acc, child) => acc + countDescendants(child), 0)
}
