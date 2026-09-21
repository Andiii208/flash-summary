import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Concept, ConceptLink, QuizItem, TreeNode } from '../../shared/notes/schema'
import { collapsedSetForMaxDepth, computeMindMapLayout, labelBoxWidth, titleBaseline, type LayoutNode } from '../../shared/notes/mindmap-layout'
import { computeRelationLayout } from '../../shared/notes/relation-layout'
import { QuizCards } from './NoteBlocks'
import { InlineText } from './InlineText'

/** M1.3 viewport transform: viewBox window over the unchanged layout geometry. */
interface View {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.4
const MAX_SCALE = 3
const IDENTITY_VIEW: View = Object.freeze({ scale: 1, x: 0, y: 0 })
/** 批3 (T13): 关系标签的字号——必须与 style.css 的 .mindmap-link-label 一致，
 *  胶囊盒宽按同一套单位模型算（CJK = 1 个字宽）。 */
const LABEL_FONT_SIZE = 11

/**
 * 批6 (P11, plan 2026-09-20-ux-issues-remediation): 视口窗口的**用户单位**尺寸。
 *
 * 旧模型把元素盒钉死在布局原宽（`<svg width={frame.width}>`），缩放只改 viewBox，
 * 于是 892px 的元素盒配 859px 的容器 = 常驻 49px 幽灵横滚条（「适应窗口」也消不掉）。
 * 新模型：窗口 = min(内容/缩放, 内容)——缩到装得下时窗口就是整幅内容（元素盒 =
 * 内容 × 缩放，装得进容器），放大时窗口小于内容（元素盒 = 布局原宽，真实溢出照常可滚）。
 * 缩放倍率不变：元素盒 / 窗口 = scale。
 */
function viewportWindow(scale: number, layoutWidth: number, layoutHeight: number): { width: number; height: number } {
  return { width: Math.min(layoutWidth / scale, layoutWidth), height: Math.min(layoutHeight / scale, layoutHeight) }
}

/** 视口偏移钳到 [0, 内容 − 窗口]——窗口不得越出内容，否则画布边出现空白带。 */
function clampOffset(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(0, max))
}

/**
 * 滚动容器的**内容盒**尺寸：clientWidth/Height 含 padding，画布元素盒必须装进
 * 内容盒（`.mindmap-scroll` 的 8px padding 会让「刚好按 clientWidth 缩」的元素盒
 * 溢出 16px）。happy-dom 里没有样式表，`parseFloat('')` 得 NaN——按 0 处理，组件
 * 测试只需 stub clientWidth/Height 的老写法继续有效。
 */
function contentBoxSize(el: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(el)
  const px = (value: string): number => parseFloat(value) || 0
  return {
    width: el.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    height: el.clientHeight - px(style.paddingTop) - px(style.paddingBottom)
  }
}

/** Zoom to `nextScale` keeping the layout point at viewport fractions fx/fy fixed. */
function zoomAt(view: View, nextScale: number, fx: number, fy: number, layoutWidth: number, layoutHeight: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
  if (scale === view.scale) return view
  const before = viewportWindow(view.scale, layoutWidth, layoutHeight)
  const after = viewportWindow(scale, layoutWidth, layoutHeight)
  const anchorX = view.x + fx * before.width
  const anchorY = view.y + fy * before.height
  return {
    scale,
    x: clampOffset(anchorX - fx * after.width, layoutWidth - after.width),
    y: clampOffset(anchorY - fy * after.height, layoutHeight - after.height)
  }
}

/** M2.3: all paths at depth ≥ 2 — the nodes the recall mode masks. */
function allRecallPaths(root: TreeNode): Set<string> {
  const paths = new Set<string>()
  const walk = (node: TreeNode, depth: number, path: string): void => {
    if (depth >= 2) paths.add(path)
    node.children.forEach((child, i) => walk(child, depth + 1, `${path}/${i}`))
  }
  walk(root, 0, '0')
  return paths
}

/** M3.2: the subtree rooted at a full path (null when the path leaves the tree). */
function subtreeAt(root: TreeNode, path: string): TreeNode | null {
  let node: TreeNode | null = root
  for (const step of path.split('/').slice(1)) {
    if (node == null) return null
    node = node.children[Number(step)] ?? null
  }
  return node
}

/** M3.2: full-space path → subtree-relative ('0'…), null when outside the focus. */
function fullToRel(full: string, focusPath: string): string | null {
  if (focusPath === '') return full
  if (full === focusPath) return '0'
  if (full.startsWith(`${focusPath}/`)) return `0${full.slice(focusPath.length)}`
  return null
}

/** M3.2: subtree-relative path → full-space path. */
function relToFull(rel: string, focusPath: string): string {
  if (focusPath === '') return rel
  return rel === '0' ? focusPath : `${focusPath}${rel.slice(1)}`
}

/** M3.2: breadcrumb entries for the current focus (root excluded — 全图 covers it). */
function crumbsFor(tree: TreeNode, focusPath: string): Array<{ path: string; title: string }> {
  const crumbs: Array<{ path: string; title: string }> = []
  let node: TreeNode | null = tree
  let acc = '0'
  for (const step of focusPath.split('/').slice(1)) {
    node = node?.children[Number(step)] ?? null
    acc = `${acc}/${step}`
    if (node == null) break
    crumbs.push({ path: acc, title: node.title })
  }
  return crumbs
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
  /** M3.1: dashed cross-links resolved by term/title in the shared layout. */
  conceptLinks?: ConceptLink[]
  /** Jump to the detailed view anchored at this concept's card. */
  onViewDetailed?: (term: string) => void
  /** M3.3: export the whole map as a standalone paper-white SVG file. */
  onExportSvg?: () => void
  /** 批5: 位图导出——光栅化在渲染层完成，这里只发指令。 */
  onExportPng?: () => void
  /** 健康巡查 2026-09-12 批5: the in-flight export kind (busy state). */
  exportBusy?: string | null
}

const EMPTY_LINKS: ConceptLink[] = []

export function MindMap({
  tree,
  concepts = [],
  quiz = [],
  conceptLinks = EMPTY_LINKS,
  onViewDetailed,
  onExportSvg,
  onExportPng,
  exportBusy = null
}: MindMapProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>(IDENTITY_VIEW)
  const [panning, setPanning] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<SVGSVGElement>(null)
  /** FLIP bookkeeping: previous y per node path (x is depth-fixed). */
  const prevYRef = useRef<Map<string, number>>(new Map())
  /** M1.3 active background-drag gesture (null = not panning). */
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; origin: View } | null>(null)
  /** M2.2 path of the node whose popover is open (null = closed). */
  const [popoverPath, setPopoverPath] = useState<string | null>(null)
  /** M2.3 recall mode: masked titles revealed one click at a time. */
  const [recall, setRecall] = useState(false)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  /** M3.2 focus: full path of the subtree shown as the map root ('' = whole map). */
  const [focusPath, setFocusPath] = useState('')

  /**
   * 批5: 关系模式——同一视图内的第二种呈现。把 `conceptLinks` 当主结构画成概念
   * 关系图（不再是树上几条 ≤5 条的虚线）。刻意**不新增第六视图**：spec §5 修订
   * 批注① 把五视图钉死了，模式切换是纯呈现层改动。
   */
  const [relationMode, setRelationMode] = useState(false)
  const relationLayout = useMemo(() => computeRelationLayout(concepts, conceptLinks), [concepts, conceptLinks])
  const canShowRelations = relationLayout.edges.length > 0

  // M3.2: the layout root — the focused subtree, or the whole tree.
  const focusTree = useMemo(() => (focusPath === '' ? tree : (subtreeAt(tree, focusPath) ?? tree)), [tree, focusPath])

  const layout = useMemo(() => {
    if (focusPath === '') return computeMindMapLayout(tree, collapsed, { links: conceptLinks })
    // Collapse set lives in full-path space; translate into subtree-relative.
    const focusCollapsed = new Set<string>()
    for (const full of collapsed) {
      const rel = fullToRel(full, focusPath)
      if (rel != null) focusCollapsed.add(rel)
    }
    return computeMindMapLayout(focusTree, focusCollapsed, { links: conceptLinks })
  }, [tree, collapsed, focusPath, conceptLinks, focusTree])

  /**
   * 缩放/平移与 viewBox 的尺寸来源：关系模式下换成关系图的画布尺寸，其余逻辑
   * （指针锚点缩放、拖拽平移、键盘）**完全复用**——两种呈现共用同一套视口。
   */
  const frame = relationMode && relationLayout.nodes.length > 0 ? relationLayout : layout

  // M2.2/M3.2: node terms keyed by LAYOUT path (relative to the focus root).
  const termsByPath = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (node: TreeNode, path: string): void => {
      if (node.terms != null && node.terms.length > 0) map.set(path, node.terms)
      node.children.forEach((child, i) => walk(child, `${path}/${i}`))
    }
    walk(focusTree, '0')
    return map
  }, [focusTree])

  // M2.2: term → concept lookup powering popover content.
  const conceptByTerm = useMemo(() => new Map(concepts.map((c) => [c.term, c])), [concepts])

  const popoverNode: LayoutNode | null = popoverPath == null ? null : (layout.nodes.find((n) => n.path === popoverPath) ?? null)
  const popoverTerms = popoverPath == null ? [] : (termsByPath.get(popoverPath) ?? [])
  const linkedConcepts = popoverTerms.map((term) => conceptByTerm.get(term)).filter((c): c is Concept => c != null)
  const linkedQuiz = useMemo(
    () => (popoverTerms.length === 0 ? [] : quiz.filter((item) => item.term != null && popoverTerms.includes(item.term))),
    [quiz, popoverTerms]
  )

  /**
   * 批3 (T15, D11): 把整张图装进视口。此前打开一张两课时的地图，svg 938×1420
   * 而滚动视口只有 525 高——竖直只显示约 37%，用户得先滚再找。scale 夹在
   * MIN_SCALE..1（不放大，只缩小到装得下），并把滚动位置居中到内容上。
   *
   * 批6 (P11): 量的是**内容盒**而不是 clientWidth/Height——clientWidth 含 padding，
   * 而 `.mindmap-scroll` 有 8px padding：按 clientWidth 算出来的元素盒加上 padding
   * 正好比容器宽 16px，就是那条「适应窗口也消不掉」的幽灵横滚（6.0 探针量到的
   * overX 就是它）。
   */
  const fitToViewport = useCallback((): boolean => {
    const el = scrollRef.current
    if (el == null || frame.width <= 0 || frame.height <= 0) return false
    const box = contentBoxSize(el)
    if (box.width <= 0 || box.height <= 0) return false
    const target = Math.min(1, Math.max(MIN_SCALE, Math.min(box.width / frame.width, box.height / frame.height)))
    setView(zoomAt(IDENTITY_VIEW, target, 0.5, 0.5, frame.width, frame.height))
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ left: Math.max(0, (frame.width - box.width) / 2), top: Math.max(0, (frame.height - box.height) / 2) })
    }
    return true
  }, [frame.width, frame.height])

  // 首屏自适应：只在首次量到内容尺寸时做一次（之后用户的缩放/平移不再被夺走）。
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current) return
    // 量到尺寸才吃这一次机会：挂载首帧 clientWidth 可能还是 0。
    if (fitToViewport()) fittedRef.current = true
  }, [fitToViewport])

  // Any pan/zoom move closes the popover — the HTML card cannot track the
  // transformed SVG content.
  useEffect(() => {
    setPopoverPath(null)
  }, [view])

  // M3.2: collapse state lives in FULL-path space; a toggle arriving from the
  // layout (subtree-relative) is translated before it lands in the set.
  const toggle = (relPath: string): void => {
    const fullPath = relToFull(relPath, focusPath)
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(fullPath)) next.delete(fullPath)
      else next.add(fullPath)
      return next
    })
  }

  // M1.2/M3.2: search matches over the LAYOUT ROOT (focused subtree or whole
  // tree) in that root's relative paths — hits inside folded branches become
  // visible because the effect below unfolds their ancestors.
  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const hits = new Set<string>()
    if (needle !== '') {
      const walk = (node: TreeNode, path: string): void => {
        if (node.title.toLowerCase().includes(needle)) hits.add(path)
        node.children.forEach((child, i) => walk(child, `${path}/${i}`))
      }
      walk(focusTree, '0')
    }
    return hits
  }, [focusTree, query])

  // M1.2: unfold every ancestor of a hit (write-back into the full-space
  // collapse set; no snapshot restore — the simpler plan trade-off).
  useLayoutEffect(() => {
    if (matched.size === 0) return
    setCollapsed((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const hitPath of matched) {
        const segments = hitPath.split('/')
        for (let end = 1; end < segments.length; end++) {
          const ancestorFull = relToFull(segments.slice(0, end).join('/'), focusPath)
          if (next.delete(ancestorFull)) changed = true
        }
      }
      return changed ? next : prev
    })
  }, [matched, focusPath])

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
      setView((prev) => zoomAt(prev, prev.scale * Math.exp(-e.deltaY * 0.002), fx, fy, frame.width, frame.height))
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [frame.width, frame.height])

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
    // 批6 (P11): 平移同样钳在内容边界内（窗口越界 = 画布边出现空白带）。
    const win = viewportWindow(pan.origin.scale, frame.width, frame.height)
    setView({
      scale: pan.origin.scale,
      x: clampOffset(pan.origin.x - (e.clientX - pan.startX) / pan.origin.scale, frame.width - win.width),
      y: clampOffset(pan.origin.y - (e.clientY - pan.startY) / pan.origin.scale, frame.height - win.height)
    })
  }

  const endPan = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (panRef.current == null || e.pointerId !== panRef.current.pointerId) return
    panRef.current = null
    setPanning(false)
  }

  /** P27 (plan 2026-09-21): 工具栏可见的放大/缩小——倍率与键盘 +/- 同一（1.2），
   *  锚点取画布中心（按钮点击没有指针位置可言）。此前缩放只有 Ctrl+滚轮与「选中
   *  画布后按 +/-」两条不可见路径，界面上没有任何放大入口，而默认窗首屏还把图
   *  压到 0.4 倍——用户实报「太小了影响观看」。 */
  const zoomBy = useCallback((factor: number): void => {
    setView((prev) => zoomAt(prev, prev.scale * factor, 0.5, 0.5, frame.width, frame.height))
  }, [frame.width, frame.height])

  /** M1.3 keyboard: +/-/=/0 zoom and reset while the canvas holds focus. */
  const canvasKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      setView((prev) => zoomAt(prev, prev.scale * 1.2, 0.5, 0.5, frame.width, frame.height))
    } else if (e.key === '-') {
      e.preventDefault()
      setView((prev) => zoomAt(prev, prev.scale / 1.2, 0.5, 0.5, frame.width, frame.height))
    } else if (e.key === '0') {
      e.preventDefault()
      fitToViewport()
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

  /** M3.2 (决策点 D5): double-click drills into the node's subtree; every
   *  focus move resets reveal state and FLIP bookkeeping (paths renumber). */
  const focusAt = (fullPath: string): void => {
    setFocusPath(fullPath)
    setRevealed(new Set())
    setPopoverPath(null)
    prevYRef.current = new Map()
  }
  const focusSubtree = (relPath: string): void => focusAt(relToFull(relPath, focusPath))

  /** Keyboard collapse/expand for a node with children (批D: parameterized). */
  const keyToggler = (path: string) => (e: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle(path)
    }
  }

  const searching = matched.size > 0
  /* 批6 (P11): 元素盒 = 视口窗口 × 缩放（不再是布局原宽）——缩放倍率仍然是
     元素盒/viewBox = scale，但缩到装得下时元素盒跟着变小，幽灵横滚条消失。 */
  const win = viewportWindow(view.scale, frame.width, frame.height)

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
        {/* 批3: 工具栏分组——折叠控制 · 视图 · 模式 · 导出，分隔线让功能域可扫读。 */}
        <span class="mindmap-toolbar-divider" aria-hidden="true" />
        <button class="btn small" onClick={fitToViewport} title="把整张图缩到刚好装进窗口（快捷键 0）">
          适应窗口
        </button>
        {/* P27 (plan 2026-09-21): 放大/缩小入口 + 倍率常驻——缩放能力本就存在
            （Ctrl+滚轮、画布聚焦后 +/-），缺的只是看得见点得到。 */}
        <button class="btn small" onClick={() => zoomBy(1.2)} title="放大（快捷键 +，或 Ctrl+滚轮）" data-testid="mindmap-zoom-in">
          放大
        </button>
        <button class="btn small" onClick={() => zoomBy(1 / 1.2)} title="缩小（快捷键 -，或 Ctrl+滚轮）" data-testid="mindmap-zoom-out">
          缩小
        </button>
        <span class="mindmap-zoom-label" data-testid="mindmap-zoom-label" title="当前缩放倍率（Ctrl+滚轮 / +/- 也可调）">
          {Math.round(view.scale * 100)}%
        </span>
        <span class="mindmap-toolbar-divider" aria-hidden="true" />
        {/* M2.3: recall mode — masks tier-2+ titles for retrieval practice
            (Karpicke & Blunt 2011); mutually exclusive with search. */}
        <button
          class={`btn small${recall ? ' primary' : ''}`}
          aria-pressed={recall}
          onClick={() => {
            if (recall) {
              setRecall(false)
              setRevealed(new Set())
            } else {
              setRecall(true)
              setQuery('')
              setRevealed(new Set())
            }
          }}
        >
          回忆模式
        </button>
        {recall && (
          <button class="btn small" onClick={() => setRevealed(allRecallPaths(focusTree))}>
            全部揭示
          </button>
        )}
        {recall && <span class="mindmap-recall-hint">先回忆再揭示：凭记忆说出这个分支讲过什么</span>}
        <span class="mindmap-toolbar-divider" aria-hidden="true" />
        {/* 批5: 关系模式——同一视图内的第二种呈现。没有可解析的关系边时按钮不出现
            （按下去只会看到一张空图）。 */}
        {canShowRelations && (
          <button
            class={`btn small${relationMode ? ' primary' : ''}`}
            aria-pressed={relationMode}
            title="把概念之间的关联当主结构画出来（不再是树上几条虚线）"
            onClick={() => setRelationMode((prev) => !prev)}
          >
            关系模式
          </button>
        )}
        {onExportSvg != null && (
          <button class="btn small" onClick={onExportSvg} disabled={exportBusy != null}>
            {exportBusy === 'svg' ? '导出中…' : '导出 SVG'}
          </button>
        )}
        {onExportPng != null && (
          <button class="btn small" onClick={onExportPng} disabled={exportBusy != null}>
            {exportBusy === 'png' ? '导出中…' : '导出 PNG'}
          </button>
        )}
        <span class="mindmap-toolbar-spacer" aria-hidden="true" />
        <input
          class="mindmap-search"
          type="search"
          placeholder="搜索节点…"
          aria-label="搜索节点"
          value={query}
          disabled={recall}
          title={recall ? '回忆模式下暂停搜索' : undefined}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </div>
      {/* 批5 (P16): 零命中空态——此前 `searching = matched.size > 0`，搜不到时
          全图原样渲染、界面毫无变化，用户会以为搜索坏了（全站唯一没有零命中
          空态的搜索）。小区空态用一行小字（.msg，SKILL §2 两种形态之一），与
          课程浏览器「没有匹配的课程…」同口径。 */}
      {query.trim() !== '' && matched.size === 0 && (
        <p class="msg mindmap-search-empty" data-testid="mindmap-search-empty">
          没有匹配的节点——换个词，或清空搜索
        </p>
      )}
      {/* M3.2/批3: breadcrumb 常驻——未下钻时也展示焦点机制的存在（可发现性），
          「全图」在焦点态下提供一键返回。 */}
      <nav class="mindmap-crumbs" aria-label="焦点分支路径">
        <button class="btn small ghost" disabled={focusPath === ''} onClick={() => focusAt('')}>
          全图
        </button>
        {focusPath === '' ? (
          <span class="mindmap-crumbs-hint">提示：双击节点可聚焦该分支，ℹ️ 查看关联概念</span>
        ) : (
          crumbsFor(tree, focusPath).map((crumb, index, all) => (
            <button key={crumb.path} class="btn small ghost" disabled={index === all.length - 1} onClick={() => focusAt(crumb.path)}>
              {crumb.title}
            </button>
          ))
        )}
      </nav>
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
        width={win.width * view.scale}
        height={win.height * view.scale}
        viewBox={`${view.x} ${view.y} ${win.width} ${win.height}`}
        role="img"
        aria-label={`知识导图：${tree.title}`}
      >
        {relationMode && relationLayout.nodes.length > 0 ? (
          /* 批5 关系模式：`conceptLinks` 当主结构。边全部可见（不再受 ≤5 条限制），
             关系词就是「命题」的关系项——体检的命题审计保证它不是名词填充。 */
          <g data-testid="mindmap-relation-layer">
            {relationLayout.edges.map((edge, index) => (
              <g key={`rel-${index}`}>
                <path d={edge.d} class="mindmap-relation-line" fill="none" />
                {edge.label !== '' && (
                  <g transform={`translate(${edge.lx}, ${edge.ly})`}>
                    <rect
                      x={-labelBoxWidth(edge.label, LABEL_FONT_SIZE) / 2}
                      y={-9}
                      width={labelBoxWidth(edge.label, LABEL_FONT_SIZE)}
                      height={18}
                      rx={9}
                      class="mindmap-link-label-box"
                    />
                    <text text-anchor="middle" y={3.5} class="mindmap-link-label">
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            ))}
            {relationLayout.nodes.map((node) => (
              <g key={`relnode-${node.id}`} class="mindmap-relation-node">
                <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={8} class="mindmap-relation-box" />
                <text x={node.x + 12} y={node.y + 22} class="mindmap-relation-term">
                  {node.lines.map((line, i) => (
                    <tspan key={i} x={node.x + 12} dy={i === 0 ? 0 : 18}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            ))}
          </g>
        ) : (
          <>
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from}-${edge.to}`}
            d={edge.d}
            style={`d: path('${edge.d}')`}
            class={`mindmap-edge edge-d${depthById.get(edge.to) ?? 1}`}
            fill="none"
          />
        ))}
        {/* M3.1: dashed cross-links with optional relation labels. */}
        {layout.links.map((link, index) => (
          <g key={`mlink-${index}`} class="mindmap-crosslink">
            <path d={link.d} class="mindmap-link-line" fill="none" />
            {link.label !== '' && (
              <g transform={`translate(${link.lx}, ${link.ly})`}>
                <rect x={-labelBoxWidth(link.label, LABEL_FONT_SIZE) / 2} y={-9} width={labelBoxWidth(link.label, LABEL_FONT_SIZE)} height={18} rx={9} class="mindmap-link-label-box" />
                <text text-anchor="middle" y={3.5} class="mindmap-link-label">
                  {link.label}
                </text>
              </g>
            )}
          </g>
        ))}
        {layout.nodes.map((node) => {
          const isRoot = node.depth === 0
          const hasChildren = node.hasChildren
          const descendants = hasChildren ? childCount(focusTree, node.path) : 0
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
              onDblClick={hasChildren ? () => focusSubtree(node.path) : undefined}
              onKeyDown={hasChildren ? keyToggler(node.path) : undefined}
              tabIndex={hasChildren ? 0 : undefined}
              role={hasChildren ? 'button' : undefined}
              aria-expanded={hasChildren ? !node.collapsed : undefined}
              aria-label={hasChildren ? `${node.title}（点击${node.collapsed ? '展开' : '折叠'}，双击聚焦此分支）` : node.title}
            >
              <title>{hasChildren ? `${node.title}（点击${node.collapsed ? '展开' : '折叠'}，双击聚焦此分支）` : node.title}</title>
              <rect width={node.width} height={node.height} rx={8} class="mindmap-box" />
              {/* 批E: wrapped tspans — long titles are fully shown, no ellipsis. */}
              <text x={12} y={titleBaseline(node)} class="mindmap-label">
                {node.lines.map((line, i) => (
                  <tspan key={i} x={12} dy={i === 0 ? 0 : 18}>
                    {line}
                  </tspan>
                ))}
              </text>
              {/* 批3: 圆点语言——折叠=实心圆点（藏着分支），展开=空心圆环（同尺寸，
                  状态一眼可辨）；替换 ▸/▾ 三角（2026-09-07 审美反馈）。
                  计数胶囊与热区不变。 */}
              {hasChildren && (
                <g class={`mindmap-caret${node.collapsed ? ' collapsed' : ''}`} transform={`translate(${node.width + 8}, ${node.height / 2})`} aria-hidden="true">
                  <circle r={11} class="caret-hit" />
                  {node.collapsed ? <circle r={4.5} class="caret-dot" /> : <circle r={4.5} class="caret-ring" />}
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
                  <title>查看关联概念与自测题</title>
                  <text y={3.5} text-anchor="middle" class="info-glyph">
                    i
                  </text>
                </g>
              )}
              {/* M2.3: recall cover — a same-surface block painted over the
                  title; one click reveals (stopPropagation keeps collapse idle). */}
              {recall && node.depth >= 2 && !revealed.has(node.path) && (
                <rect
                  class="recall-cover"
                  width={node.width}
                  height={node.height}
                  rx={8}
                  role="button"
                  tabIndex={0}
                  aria-label={`揭示「${node.title}」`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setRevealed((prev) => new Set(prev).add(node.path))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      setRevealed((prev) => new Set(prev).add(node.path))
                    }
                  }}
                />
              )}
            </g>
          )
        })}
          </>
        )}
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
                    {/* 健康巡查 2026-09-12: definitions go through InlineText —
                        the model freely emits **bold** markers and the detailed
                        view renders them; the popover must not print literal
                        asterisks (AGENTS 笔记字段渲染约定). */}
                    <strong>{concept.term}</strong>：<InlineText text={concept.definition} />
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
