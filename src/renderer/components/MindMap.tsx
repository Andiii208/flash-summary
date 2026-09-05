import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Concept, QuizItem, TreeNode } from '../../shared/notes/schema'
import { collapsedSetForMaxDepth, computeMindMapLayout, titleBaseline, type LayoutNode } from '../../shared/notes/mindmap-layout'
import { QuizCards } from './NoteBlocks'

/** M1.3 viewport transform: viewBox window over the unchanged layout geometry. */
interface View {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.4
const MAX_SCALE = 3
const IDENTITY_VIEW: View = Object.freeze({ scale: 1, x: 0, y: 0 })

/** Zoom to `nextScale` keeping the layout point at viewport fractions fx/fy fixed. */
function zoomAt(view: View, nextScale: number, fx: number, fy: number, layoutWidth: number, layoutHeight: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
  if (scale === view.scale) return view
  const anchorX = view.x + fx * (layoutWidth / view.scale)
  const anchorY = view.y + fy * (layoutHeight / view.scale)
  return { scale, x: anchorX - fx * (layoutWidth / scale), y: anchorY - fy * (layoutHeight / scale) }
}

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
 *
 * M1.3 (map expansion): Ctrl/⌘+wheel zooms around the pointer, background
 * drag pans, keyboard +/-/0 zoom & reset — all as viewBox transforms, the
 * layout geometry stays untouched (PDF handout shares it unchanged).
 */
/** M2.2 node popover: linked concepts + anchored quiz + a jump into the
 *  detailed view (决策点 D2 — the node body keeps its collapse click, the
 *  ℹ️ button opens the card). */
export interface MindMapProps {
  tree: TreeNode
  concepts?: Concept[]
  quiz?: QuizItem[]
  /** Jump to the detailed view anchored at this concept's card. */
  onViewDetailed?: (term: string) => void
}

export function MindMap({ tree, concepts = [], quiz = [], onViewDetailed }: MindMapProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>(IDENTITY_VIEW)
  const [panning, setPanning] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const layout = useMemo(() => computeMindMapLayout(tree, collapsed), [tree, collapsed])
  const rootRef = useRef<SVGSVGElement>(null)
  /** FLIP bookkeeping: previous y per node path (x is depth-fixed). */
  const prevYRef = useRef<Map<string, number>>(new Map())
  /** M1.3 active background-drag gesture (null = not panning). */
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; origin: View } | null>(null)
  /** M2.2 path of the node whose popover is open (null = closed). */
  const [popoverPath, setPopoverPath] = useState<string | null>(null)

  // M2.2: node terms keyed by layout path (screen layout keeps subline empty,
  // so the anchor map walks the tree in parallel with the path convention).
  const termsByPath = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (node: TreeNode, path: string): void => {
      if (node.terms != null && node.terms.length > 0) map.set(path, node.terms)
      node.children.forEach((child, i) => walk(child, `${path}/${i}`))
    }
    walk(tree, '0')
    return map
  }, [tree])

  // M2.2: term → concept lookup powering popover content.
  const conceptByTerm = useMemo(() => new Map(concepts.map((c) => [c.term, c])), [concepts])

  const popoverNode: LayoutNode | null = popoverPath == null ? null : (layout.nodes.find((n) => n.path === popoverPath) ?? null)
  const popoverTerms = popoverPath == null ? [] : (termsByPath.get(popoverPath) ?? [])
  const linkedConcepts = popoverTerms.map((term) => conceptByTerm.get(term)).filter((c): c is Concept => c != null)
  const linkedQuiz = useMemo(
    () => (popoverTerms.length === 0 ? [] : quiz.filter((item) => item.term != null && popoverTerms.includes(item.term))),
    [quiz, popoverTerms]
  )

  // Any pan/zoom move closes the popover — the HTML card cannot track the
  // transformed SVG content.
  useEffect(() => {
    setPopoverPath(null)
  }, [view])

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

  // M1.3: Ctrl/⌘+wheel zooms around the pointer — a native non-passive
  // listener so preventDefault beats the browser page-zoom; a plain wheel
  // (no modifier) falls through to native scrolling.
  useEffect(() => {
    const container = scrollRef.current
    if (container == null) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = (rootRef.current ?? container).getBoundingClientRect()
      const fx = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5
      const fy = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5
      setView((prev) => zoomAt(prev, prev.scale * Math.exp(-e.deltaY * 0.002), fx, fy, layout.width, layout.height))
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [layout.width, layout.height])

  // M1.3: background drag pans via the viewBox offset. A drag starting on a
  // node stays a click so collapse keeps its single-click semantics.
  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if ((e.target as Element).closest?.('.mindmap-node') != null) return
    panRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: view }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture unavailable (env without active-pointer tracking): panning
      // still works while the pointer stays over the canvas.
    }
    setPanning(true)
  }

  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current
    if (pan == null || e.pointerId !== pan.pointerId) return
    setView({
      scale: pan.origin.scale,
      x: pan.origin.x - (e.clientX - pan.startX) / pan.origin.scale,
      y: pan.origin.y - (e.clientY - pan.startY) / pan.origin.scale
    })
  }

  const endPan = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (panRef.current == null || e.pointerId !== panRef.current.pointerId) return
    panRef.current = null
    setPanning(false)
  }

  /** M1.3 keyboard: +/-/=/0 zoom and reset while the canvas holds focus. */
  const canvasKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      setView((prev) => zoomAt(prev, prev.scale * 1.2, 0.5, 0.5, layout.width, layout.height))
    } else if (e.key === '-') {
      e.preventDefault()
      setView((prev) => zoomAt(prev, prev.scale / 1.2, 0.5, 0.5, layout.width, layout.height))
    } else if (e.key === '0') {
      e.preventDefault()
      setView(IDENTITY_VIEW)
    }
  }

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
        <button class="btn small" onClick={() => setView(IDENTITY_VIEW)}>
          重置视图
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
      <div
        class={`mindmap-scroll${panning ? ' panning' : ''}`}
        ref={scrollRef}
        tabIndex={0}
        aria-label={`导图画布：Ctrl+滚轮缩放，按住拖拽平移，+/-/0 缩放与复位`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onKeyDown={canvasKeyDown}
      >
      <svg
        ref={rootRef}
        width={layout.width}
        height={layout.height}
        viewBox={`${view.x} ${view.y} ${layout.width / view.scale} ${layout.height / view.scale}`}
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
          const nodeTerms = termsByPath.get(node.path)
          const hasAnchor = nodeTerms != null && nodeTerms.length > 0
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
              <text x={12} y={titleBaseline(node)} class="mindmap-label">
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
              {/* M2.2: ℹ️ opens the linked-content popover; stopPropagation keeps
                  the node body's collapse click (决策点 D2 hot-zone split). */}
              {hasAnchor && (
                <g
                  class="mindmap-info"
                  role="button"
                  tabIndex={0}
                  aria-label={`查看「${node.title}」的关联概念`}
                  transform={`translate(${node.width - 11}, ${node.height - 11})`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPopoverPath(node.path)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      setPopoverPath(node.path)
                    }
                  }}
                >
                  <circle r={7} class="info-hit" />
                  <text y={3.5} text-anchor="middle" class="info-glyph">
                    i
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
      {/* M2.2 popover: fixed backdrop closes on any outside click; the card
          itself lives in scroll-content coordinates (closed on pan/zoom). */}
      {popoverNode != null && popoverTerms.length > 0 && (
        <>
          <div class="mindmap-popover-backdrop" onClick={() => setPopoverPath(null)} aria-hidden="true" />
          <div class="mindmap-popover" data-testid="mindmap-popover" style={`left:${Math.max(0, Math.min(popoverNode.x + popoverNode.width + 24, layout.width - 324))}px; top:${popoverNode.y}px`}>
            <div class="mindmap-popover-head">
              <strong>{popoverNode.title}</strong>
              <button class="btn small ghost" onClick={() => setPopoverPath(null)} aria-label="关闭浮层">
                ×
              </button>
            </div>
            {linkedConcepts.length > 0 && (
              <div class="mindmap-popover-section">
                <h4>关联概念</h4>
                {linkedConcepts.map((concept) => (
                  <p key={concept.term} class="mindmap-popover-concept">
                    <strong>{concept.term}</strong>：{concept.definition}
                  </p>
                ))}
              </div>
            )}
            {linkedQuiz.length > 0 && (
              <div class="mindmap-popover-section">
                <h4>相关自测</h4>
                <QuizCards items={linkedQuiz} />
              </div>
            )}
            {onViewDetailed != null && linkedConcepts.length > 0 && (
              <button
                class="btn small primary"
                onClick={() => {
                  onViewDetailed(linkedConcepts[0]!.term)
                  setPopoverPath(null)
                }}
              >
                在详细笔记中查看
              </button>
            )}
          </div>
        </>
      )}
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
