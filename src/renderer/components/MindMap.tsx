import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Concept, ConceptLink, QuizItem, TreeNode } from '../../shared/notes/schema'
import { collapsedSetForMaxDepth, computeMindMapLayout, labelBoxWidth, titleBaseline, type LayoutNode } from '../../shared/notes/mindmap-layout'
import { computeRelationLayout } from '../../shared/notes/relation-layout'
import { toPlainText } from '../../shared/notes/md-lite'
import { QuizCards } from './NoteBlocks'
import { InlineText } from './InlineText'
import { SvgLineTspans, SvgTspans } from './SvgInline'

/**
 * P51 (plan 2026-09-22-qa-dock-float-window): 导图回归「普通内容块」——**内部缩放/平移
 * 整套移除**（Andiii：「不应该是在内部去放大和缩小呀，应该跟其他界面一样可以直接下滑……
 * 不需要你设置一个内部的放大缩小」）。两种 fit：
 *   width  按容器**宽**拟合，高度按比例跟着长，页面原生下滑看完（笔记页默认）；
 *   box    宽高都拟合进容器（课程导图弹层 / 全图浏览弹层——容器有确定高度）。
 * FIT_MARGIN_PX 就是 Andiii 要的「余量」：图不贴边。旧「内部滚动 + viewBox 平移」那套
 * 的病（窗口=容器高 ⇒ 竖直无可滚内容、平移把底部钳走 ⇒ 划不到底、图也不完全）随之消失。
 */
export type MindMapFit = 'width' | 'box'

const FIT_MARGIN_PX = 16
/** fit='box' 的倍率下限：图大到拟合不出可读尺寸时兜底，交给容器滚动。 */
const MIN_SCALE = 0.4
/** 批3 (T13): 关系标签的字号——必须与 style.css 的 .mindmap-link-label 一致，
 *  胶囊盒宽按同一套单位模型算（CJK = 1 个字宽）。 */
const LABEL_FONT_SIZE = 11

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
 * P51 (plan 2026-09-22): 内部缩放/平移已移除——导图是普通内容块，按容器宽适合比例
 * 呈现、页面原生下滑看完；看不清时用工具栏「全图」开全屏浏览弹层。布局几何本身
 * 不变（PDF handout / SVG 导出照旧共用）。
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
  /** P51 (plan 2026-09-22): 适合比例模式——width=按容器宽拟合（默认，页面下滑看完），
   *  box=宽高都拟合进容器（课程导图弹层/全图浏览弹层这类有确定高度的宿主）。 */
  fit?: MindMapFit
  /** P51: 传了才在工具栏渲染「全图」钮（开全屏浏览弹层）——弹层内的实例不传，
   *  避免套娃。 */
  onOpenFullMap?: () => void
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
  exportBusy = null,
  fit = 'width',
  onOpenFullMap
}: MindMapProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  /** P51: 只剩一个「适合比例」倍率（≤1，只缩小不放大），没有任何 pan/zoom 状态。 */
  const [scale, setScale] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<SVGSVGElement>(null)
  /** FLIP bookkeeping: previous y per node path (x is depth-fixed). */
  const prevYRef = useRef<Map<string, number>>(new Map())
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
   * P51: 适合比例倍率——容器宽（fit='width'）或宽高（fit='box'）拟合，留
   * FIT_MARGIN_PX 余量（Andiii「你可以设置一个余量」）。≤1：只把大图缩小到装得下，
   * 小图不放大（放大了节点文字跟着矢量放大，反而稀散）。width 模式下高度按比例跟着
   * 长，交给**页面原生滚动**看完——不再有内部滚动盒。
   *
   * 量的是滚动容器的**内容盒**（clientWidth/Height 含 padding，见 contentBoxSize）。
   * ResizeObserver 让侧栏折叠/窗口缩放/弹层尺寸变化都能重算；happy-dom 没有
   * ResizeObserver，按「仅布局变化时重算」退化（组件测试 stub clientWidth 即可）。
   */
  const measureScale = useCallback((): void => {
    const el = scrollRef.current
    if (el == null || frame.width <= 0 || frame.height <= 0) return
    const box = contentBoxSize(el)
    if (box.width <= 0) return
    const byWidth = (box.width - FIT_MARGIN_PX * 2) / frame.width
    const target = fit === 'box' ? Math.min(byWidth, box.height > 0 ? (box.height - FIT_MARGIN_PX * 2) / frame.height : 1) : byWidth
    setScale(Math.min(1, Math.max(MIN_SCALE, target)))
  }, [frame.width, frame.height, fit])

  useLayoutEffect(measureScale, [measureScale])

  // 容器尺寸变化（窗口缩放/侧栏折叠/弹层）时重算——只观察存在的环境。
  useEffect(() => {
    const el = scrollRef.current
    if (el == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measureScale())
    observer.observe(el)
    return () => observer.disconnect()
  }, [measureScale])

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
        {/* P51 (plan 2026-09-22): 内部缩放/平移整套移除，视图组只剩「全图」——图按容器
            宽适合比例呈现、页面下滑看完；元素太多看不清时点它开全屏浏览弹层
            （Andiii：「不需要你设置一个内部的放大缩小……用户可以直接点击全图去看」）。 */}
        {onOpenFullMap != null && (
          <button class="btn small" onClick={onOpenFullMap} title="全屏浏览整张导图（元素多、看不清时用）" data-testid="mindmap-full-map">
            全图
          </button>
        )}
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
        {/* P51: 改名「返回整图」——工具栏那颗「全图」是开全屏浏览弹层，两者消歧；
            未下钻时它本来就是 disabled 的（曾让人以为「全图打不开」）。 */}
        <button class="btn small ghost" disabled={focusPath === ''} onClick={() => focusAt('')}>
          返回整图
        </button>
        {focusPath === '' ? (
          <span class="mindmap-crumbs-hint">提示：双击节点可聚焦该分支，ℹ️ 查看关联概念</span>
        ) : (
          crumbsFor(tree, focusPath).map((crumb, index, all) => (
            <button key={crumb.path} class="btn small ghost" disabled={index === all.length - 1} onClick={() => focusAt(crumb.path)}>
              {/* 批4 (H3): 面包屑节点标题是模型文本 */}
              <InlineText text={crumb.title} />
            </button>
          ))
        )}
      </nav>
      {/* P51: 普通内容块——没有内部滚动/缩放/拖拽；高度按比例跟着宽走，页面原生下滑
          看完（fit='width'）。弹层宿主（fit='box'）里容器有确定高度，图整体装进盒子。 */}
      <div class="mindmap-scroll" ref={scrollRef}>
      <svg
        ref={rootRef}
        width={Math.round(frame.width * scale)}
        height={Math.round(frame.height * scale)}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        role="img"
        aria-label={`知识导图：${toPlainText(tree.title)}`}
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
                      x={-labelBoxWidth(toPlainText(edge.label), LABEL_FONT_SIZE) / 2}
                      y={-9}
                      width={labelBoxWidth(toPlainText(edge.label), LABEL_FONT_SIZE)}
                      height={18}
                      rx={9}
                      class="mindmap-link-label-box"
                    />
                    {/* 批4 (H3): 关系词是模型文本——SVG text 里放不了 <strong>/
                        <mark>，按 SvgInline 的 tspan 分段映射渲染 */}
                    <text text-anchor="middle" y={3.5} class="mindmap-link-label">
                      <SvgTspans text={edge.label} x={0} />
                    </text>
                  </g>
                )}
              </g>
            ))}
            {relationLayout.nodes.map((node) => (
              <g key={`relnode-${node.id}`} class="mindmap-relation-node">
                <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={8} class="mindmap-relation-box" />
                <text x={node.x + 12} y={node.y + 22} class="mindmap-relation-term">
                  <SvgLineTspans lines={node.lines} x={node.x + 12} lineStep={18} />
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
                <rect x={-labelBoxWidth(toPlainText(link.label), LABEL_FONT_SIZE) / 2} y={-9} width={labelBoxWidth(toPlainText(link.label), LABEL_FONT_SIZE)} height={18} rx={9} class="mindmap-link-label-box" />
                {/* 批4 (H3): 交叉关系标签同样过 tspan 分段（理由同关系模式） */}
                <text text-anchor="middle" y={3.5} class="mindmap-link-label">
                  <SvgTspans text={link.label} x={0} />
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
              aria-label={hasChildren ? `${toPlainText(node.title)}（点击${node.collapsed ? '展开' : '折叠'}，双击聚焦此分支）` : toPlainText(node.title)}
            >
              <title>{hasChildren ? `${toPlainText(node.title)}（点击${node.collapsed ? '展开' : '折叠'}，双击聚焦此分支）` : toPlainText(node.title)}</title>
              <rect width={node.width} height={node.height} rx={8} class="mindmap-box" />
              {/* 批E: wrapped tspans — long titles are fully shown, no ellipsis.
                  批4 (H3): 每行再按 md-lite token 分段（SVG 里放不了 <strong>/
                  <mark>）；x 只落在每行首段，其余分段续在同一文本块里，换行位置
                  与 x 基准都不变。 */}
              <text x={12} y={titleBaseline(node)} class="mindmap-label">
                <SvgLineTspans lines={node.lines} x={12} lineStep={18} />
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
                  aria-label={`查看「${toPlainText(node.title)}」的关联概念`}
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
                  aria-label={`揭示「${toPlainText(node.title)}」`}
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
              {/* 批4 (H3): 弹层标题与概念名都是模型文本——同走 InlineText */}
              <strong>
                <InlineText text={popoverNode.title} />
              </strong>
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
                        asterisks (AGENTS 笔记字段渲染约定).
                        批4 (H3): 术语名自己也过一遍——上一行刚说完不能印字面星号，
                        下一行自己犯了同一个错（<strong>{concept.term}</strong>）。 */}
                    <strong>
                      <InlineText text={concept.term} />
                    </strong>
                    ：<InlineText text={concept.definition} />
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
