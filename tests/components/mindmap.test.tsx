import { describe, expect, it } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach } from 'vitest'
import { MindMap } from '../../src/renderer/components/MindMap'
import type { TreeNode } from '../../src/shared/notes/schema'

const TREE: TreeNode = {
  title: '根',
  children: [
    {
      title: '第一章',
      children: [
        { title: '1.1 概念', children: [] },
        { title: '1.2 方法', children: [] }
      ]
    },
    { title: '第二章', children: [] }
  ]
}

function mountMindMap(tree: TreeNode): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => render(<MindMap tree={tree} />, host))
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('MindMap 批D', () => {
  it('renders a caret for every node with children, none for leaves', () => {
    const host = mountMindMap(TREE)
    // 根 + 第一章 have children; 1.1/1.2/第二章 are leaves.
    expect(host.querySelectorAll('.mindmap-caret')).toHaveLength(2)
    expect(host.querySelectorAll('.mindmap-node')).toHaveLength(5)
  })

  it('批3: the caret speaks in dots — a filled dot when folded, a hollow ring when expanded', () => {
    const host = mountMindMap(TREE)
    // Everything starts expanded: rings only.
    expect(host.querySelectorAll('.mindmap-caret .caret-ring')).toHaveLength(2)
    expect(host.querySelectorAll('.mindmap-caret .caret-dot')).toHaveLength(0)
    const collapsible = Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node[role="button"]'))
    const chapter = collapsible.find((g) => g.getAttribute('aria-label')?.startsWith('第一章'))
    act(() => {
      chapter?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // After folding 第一章: its caret is the filled dot, the root keeps the ring.
    expect(host.querySelectorAll('.mindmap-caret .caret-dot')).toHaveLength(1)
    expect(host.querySelectorAll('.mindmap-caret .caret-ring')).toHaveLength(1)
    // No triangle path survives the swap.
    expect(host.querySelectorAll('.caret-tri')).toHaveLength(0)
  })

  it('批3: branch nodes advertise 双击聚焦 and the crumbs row is always present', () => {
    const host = mountMindMap(TREE)
    const branch = host.querySelector('.mindmap-node[role="button"]')
    expect(branch?.getAttribute('aria-label')).toContain('双击聚焦此分支')
    expect(branch?.querySelector('title')?.textContent).toContain('双击聚焦此分支')
    // Unfocused state still shows the focus mechanism (discoverability).
    expect(host.querySelector('.mindmap-crumbs')).not.toBeNull()
    expect(host.querySelector('.mindmap-crumbs')?.textContent).toContain('全图')
    expect(host.querySelector('.mindmap-crumbs-hint')?.textContent).toContain('双击节点可聚焦')
  })

  it('shows the folded-descendant pill and no «…» suffix when collapsed (批D)', () => {
    const host = mountMindMap(TREE)
    const collapsible = Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node[role="button"]'))
    const chapter = collapsible.find((g) => g.getAttribute('aria-label')?.startsWith('第一章'))
    act(() => {
      chapter?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelectorAll('.caret-count')).toHaveLength(1)
    expect(host.querySelector('.caret-count')?.textContent).toBe('2')
    // No ellipsis suffix anywhere in the labels.
    const labels = Array.from(host.querySelectorAll('text.mindmap-label')).map((t) => t.textContent ?? '')
    expect(labels.every((text) => !text.includes('…'))).toBe(true)
  })

  it('encodes edge depth classes for the fading trunk (批D)', () => {
    const host = mountMindMap(TREE)
    expect(host.querySelector('.mindmap-edge.edge-d1')).not.toBeNull()
    expect(host.querySelector('.mindmap-edge.edge-d2')).not.toBeNull()
  })

  it('keeps aria-expanded semantics on the clickable node (批D)', () => {
    const host = mountMindMap(TREE)
    const chapter = Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node[role="button"]')).find((g) =>
      g.getAttribute('aria-label')?.startsWith('第一章')
    )
    expect(chapter?.getAttribute('aria-expanded')).toBe('true')
    act(() => {
      chapter?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(
      Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node[role="button"]'))
        .find((g) => g.getAttribute('aria-label')?.startsWith('第一章'))
        ?.getAttribute('aria-expanded')
    ).toBe('false')
  })
})

describe('MindMap M1.2 工具栏', () => {
  it('renders depth buttons and a search input', () => {
    const host = mountMindMap(TREE)
    const toolbar = host.querySelector('[data-testid="mindmap-toolbar"]')
    expect(toolbar).not.toBeNull()
    const labels = Array.from(toolbar!.querySelectorAll('button')).map((b) => b.textContent)
    expect(labels).toEqual(['全部收起', '展开 L2', '展开 L3', '全部展开', '适应窗口', '回忆模式'])
    expect(toolbar!.querySelector('.mindmap-search')).not.toBeNull()
  })

  it('全部收起 folds every branchable node; 全部展开 restores', () => {
    const host = mountMindMap(TREE)
    const clickButton = (label: string): void => {
      const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)
      act(() => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }
    clickButton('全部收起')
    const branch = Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node[role="button"]')).find((g) =>
      g.getAttribute('aria-label')?.startsWith('第一章')
    )
    expect(branch?.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('.caret-count')).toHaveLength(1)
    clickButton('全部展开')
    expect(
      Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node[role="button"]'))
        .find((g) => g.getAttribute('aria-label')?.startsWith('第一章'))
        ?.getAttribute('aria-expanded')
    ).toBe('true')
    expect(host.querySelectorAll('.caret-count')).toHaveLength(0)
  })

  it('search highlights hits, dims the rest, and unfolds hit ancestors', () => {
    const host = mountMindMap(TREE)
    const clickButton = (label: string): void => {
      const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)
      act(() => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
    }
    clickButton('全部收起')
    // Chapter folded → 3 rendered nodes (根/第一章/第二章); the leaf is hidden.
    expect(host.querySelectorAll('.mindmap-node')).toHaveLength(3)
    const input = host.querySelector<HTMLInputElement>('.mindmap-search')!
    act(() => {
      input.value = '1.1'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // The hit's ancestor chain unfolded → the leaf is rendered again.
    expect(host.querySelectorAll('.mindmap-node')).toHaveLength(5)
    const hit = Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node')).find((g) =>
      g.getAttribute('aria-label')?.startsWith('1.1')
    )
    expect(hit?.classList.contains('search-hit')).toBe(true)
    expect(host.querySelectorAll('.mindmap-node.search-hit')).toHaveLength(1)
    expect(host.querySelectorAll('.mindmap-node.search-dim')).toHaveLength(4)
  })

  it('clearing the search removes highlight and dim classes', () => {
    const host = mountMindMap(TREE)
    const input = host.querySelector<HTMLInputElement>('.mindmap-search')!
    act(() => {
      input.value = '概念'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelectorAll('.mindmap-node.search-hit')).toHaveLength(1)
    act(() => {
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelectorAll('.mindmap-node.search-hit')).toHaveLength(0)
    expect(host.querySelectorAll('.mindmap-node.search-dim')).toHaveLength(0)
  })
})

describe('MindMap M1.3 缩放与平移', () => {
  const viewBoxOf = (host: HTMLElement): number[] =>
    host.querySelector('svg')!.getAttribute('viewBox')!.split(/\s+/).map(Number)

  /** 批3: 适应窗口按滚动容器的 clientWidth/Height 算缩放——happy-dom 里量到 0，
   *  所以测试显式给一个可测视口（真实浏览器由布局给出）。 */
  const stubViewport = (host: HTMLElement, width: number, height: number): void => {
    const container = host.querySelector<HTMLElement>('.mindmap-scroll')!
    Object.defineProperty(container, 'clientWidth', { value: width, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: height, configurable: true })
  }

  const fireWheel = (host: HTMLElement, init: WheelEventInit): void => {
    const container = host.querySelector('.mindmap-scroll')!
    act(() => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: init.deltaY })
      // happy-dom drops the MouseEvent modifier init on WheelEvent — patch
      // the instance so the handler sees the shape a real browser delivers.
      Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey ?? false })
      container.dispatchEvent(event)
    })
  }

  it('starts at identity (scale 1, origin 0,0)', () => {
    const host = mountMindMap(TREE)
    const [x, y] = viewBoxOf(host)
    expect(x).toBe(0)
    expect(y).toBe(0)
  })

  it('Ctrl+wheel zooms in; a plain wheel leaves the view untouched', () => {
    const host = mountMindMap(TREE)
    const before = viewBoxOf(host)
    fireWheel(host, { ctrlKey: true, deltaY: -120 })
    const [, , wIn] = viewBoxOf(host)
    expect(wIn).toBeLessThan(before[2]!)
    // A plain wheel is native scrolling — the zoom state must not move.
    const afterZoom = viewBoxOf(host)
    fireWheel(host, { deltaY: 120 })
    expect(viewBoxOf(host)).toEqual(afterZoom)
  })

  it('zoom clamps at 3x, and 适应窗口 fits the whole map back into the viewport', () => {
    const host = mountMindMap(TREE)
    const svg = host.querySelector('svg')!
    const contentW = Number(svg.getAttribute('width'))
    const contentH = Number(svg.getAttribute('height'))
    const [, , w0] = viewBoxOf(host)
    for (let i = 0; i < 20; i++) fireWheel(host, { ctrlKey: true, deltaY: -120 })
    expect(viewBoxOf(host)[2]).toBeCloseTo(w0! / 3, 4)

    stubViewport(host, 400, 300)
    const fit = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '适应窗口')
    act(() => {
      fit?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // 批3 (T15): 适应窗口把整张图缩到装进视口（只缩小不放大，scale 夹在 0.4..1）。
    const scale = contentW / viewBoxOf(host)[2]!
    expect(scale).toBeCloseTo(Math.min(1, Math.max(0.4, Math.min(400 / contentW, 300 / contentH))), 4)
    expect(contentW * scale).toBeLessThanOrEqual(400 + 0.5)
    expect(contentH * scale).toBeLessThanOrEqual(300 + 0.5)
  })

  it('keyboard +/-/0 zooms and fits while the canvas holds focus', () => {
    const host = mountMindMap(TREE)
    const container = host.querySelector<HTMLElement>('.mindmap-scroll')!
    const [, , w0] = viewBoxOf(host)
    act(() => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
    })
    expect(viewBoxOf(host)[2]).toBeLessThan(w0!)
    // 0 = 适应窗口（批3 起不再是回到 1:1）。
    stubViewport(host, 400, 300)
    act(() => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))
    })
    expect(viewBoxOf(host)[2]).toBeGreaterThan(w0!)
  })

  it('background drag pans the viewBox; a drag on a node does not', () => {
    const host = mountMindMap(TREE)
    const svg = host.querySelector('svg')!
    const container = host.querySelector<HTMLElement>('.mindmap-scroll')!
    const pointer = (type: string, target: EventTarget, init: MouseEventInit & { pointerId?: number }): void => {
      act(() => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }))
      })
    }
    pointer('pointerdown', svg, { clientX: 100, clientY: 100, pointerId: 1 })
    pointer('pointermove', container, { clientX: 160, clientY: 130, pointerId: 1 })
    pointer('pointerup', container, { clientX: 160, clientY: 130, pointerId: 1 })
    const [x, y] = viewBoxOf(host)
    expect(x).toBeCloseTo(-60, 4)
    expect(y).toBeCloseTo(-30, 4)
    // After pointerup the gesture is over — further moves change nothing.
    pointer('pointermove', container, { clientX: 300, clientY: 300, pointerId: 1 })
    expect(viewBoxOf(host)[0]).toBeCloseTo(-60, 4)
    // A drag starting on a node is a click, not a pan.
    pointer('pointerdown', host.querySelector('.mindmap-node')!, { clientX: 10, clientY: 10, pointerId: 2 })
    pointer('pointermove', container, { clientX: 200, clientY: 200, pointerId: 2 })
    pointer('pointerup', container, { clientX: 200, clientY: 200, pointerId: 2 })
    expect(viewBoxOf(host)[0]).toBeCloseTo(-60, 4)
  })
})

describe('MindMap M2.2 节点信息浮层', () => {
  const CONCEPTS = [
    { term: '递归', definition: '函数调用自身', refs: [] },
    { term: '栈', definition: '后进先出', refs: [] }
  ]
  const QUIZ = [
    { question: '递归的三要素？', answer: '基准、递推、收敛。', source: 'concept' as const, term: '递归' },
    { question: '无关题', answer: '略。', source: 'examCue' as const }
  ]
  const ANCHORED_TREE: TreeNode = {
    title: '根',
    children: [{ title: '第一章', terms: ['递归'], children: [{ title: '1.1', children: [] }] }]
  }

  function mountAnchored(onViewDetailed?: (term: string) => void): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => {
      render(<MindMap tree={ANCHORED_TREE} concepts={CONCEPTS} quiz={QUIZ} onViewDetailed={onViewDetailed} />, host)
    })
    return host
  }

  it('renders the ℹ️ button only on nodes with resolvable anchors', () => {
    const host = mountAnchored()
    expect(host.querySelectorAll('.mindmap-info')).toHaveLength(1)
    const plain = mountMindMap(TREE)
    expect(plain.querySelectorAll('.mindmap-info')).toHaveLength(0)
  })

  it('健康巡查 2026-09-12: popover concept definitions render inline markdown, not literal asterisks', () => {
    // The model freely emits **bold** in definitions; the detailed view runs
    // them through InlineText — the popover must not print literal asterisks.
    const host = document.createElement('div')
    document.body.appendChild(host)
    const concepts = [{ term: '递归', definition: '函数**调用自身**的过程', refs: [] }]
    act(() => {
      render(<MindMap tree={ANCHORED_TREE} concepts={concepts} quiz={QUIZ} />, host)
    })
    act(() => {
      host.querySelector('.mindmap-info')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const popover = host.querySelector('[data-testid="mindmap-popover"]')
    expect(popover).not.toBeNull()
    // The concept line's first <strong> is the term; the definition arrives
    // through InlineText, so the model's **bold** becomes a second <strong>
    // instead of literal asterisks.
    const conceptPara = popover!.querySelector('.mindmap-popover-concept')
    const bolds = Array.from(conceptPara?.querySelectorAll('strong') ?? []).map((s) => s.textContent)
    expect(bolds).toContain('调用自身')
    expect(popover!.textContent).not.toContain('**')
  })

  it('popover shows the linked concept and only quiz anchored to its terms', () => {
    const host = mountAnchored()
    act(() => {
      host.querySelector('.mindmap-info')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const popover = host.querySelector('[data-testid="mindmap-popover"]')
    expect(popover).not.toBeNull()
    expect(popover!.textContent).toContain('递归')
    expect(popover!.textContent).toContain('函数调用自身')
    expect(popover!.textContent).toContain('递归的三要素？')
    expect(popover!.textContent).not.toContain('无关题')
    // Answer is hidden until the card flips.
    expect(popover!.textContent).not.toContain('基准、递推、收敛。')
    act(() => {
      popover!.querySelector('.quiz-flip')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="mindmap-popover"]')!.textContent).toContain('基准、递推、收敛。')
  })

  it('clicking the node body still collapses — ℹ️ does not trigger the fold', () => {
    const host = mountAnchored()
    act(() => {
      host.querySelector('.mindmap-info')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="mindmap-popover"]')).not.toBeNull()
    const chapter = Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node[role="button"]')).find((g) =>
      g.getAttribute('aria-label')?.startsWith('第一章')
    )
    expect(chapter?.getAttribute('aria-expanded')).toBe('true')
  })

  it('the jump button calls onViewDetailed with the anchored term', () => {
    let jumped: string | null = null
    const host = mountAnchored((term) => {
      jumped = term
    })
    act(() => {
      host.querySelector('.mindmap-info')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const jump = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '在详细笔记中查看')
    act(() => {
      jump?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(jumped).toBe('递归')
    expect(host.querySelector('[data-testid="mindmap-popover"]')).toBeNull()
  })

  it('backdrop click closes the popover', () => {
    const host = mountAnchored()
    act(() => {
      host.querySelector('.mindmap-info')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelector('[data-testid="mindmap-popover"]')).not.toBeNull()
    act(() => {
      host.querySelector('.mindmap-popover-backdrop')!.dispatchEvent(new MouseEvent('click', { bubbles: false }))
    })
    expect(host.querySelector('[data-testid="mindmap-popover"]')).toBeNull()
  })
})

describe('MindMap M2.3 回忆模式', () => {
  const clickButton = (host: HTMLElement, label: string): void => {
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('masks tier-2+ nodes with covers; tier 0/1 stay visible', () => {
    const host = mountMindMap(TREE)
    clickButton(host, '回忆模式')
    // TREE: two leaves sit at depth 2 (1.1/1.2); 第二章 is depth 1.
    expect(host.querySelectorAll('.recall-cover')).toHaveLength(2)
    clickButton(host, '回忆模式')
    expect(host.querySelectorAll('.recall-cover')).toHaveLength(0)
  })

  it('clicking a cover reveals just that node', () => {
    const host = mountMindMap(TREE)
    clickButton(host, '回忆模式')
    const covers = Array.from(host.querySelectorAll<SVGRectElement>('.recall-cover'))
    act(() => {
      covers[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelectorAll('.recall-cover')).toHaveLength(1)
  })

  it('全部揭示 clears every cover', () => {
    const host = mountMindMap(TREE)
    clickButton(host, '回忆模式')
    clickButton(host, '全部揭示')
    expect(host.querySelectorAll('.recall-cover')).toHaveLength(0)
  })

  it('is mutually exclusive with search: entering recall clears the query and disables the input', () => {
    const host = mountMindMap(TREE)
    const input = host.querySelector<HTMLInputElement>('.mindmap-search')!
    act(() => {
      input.value = '1.1'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelectorAll('.mindmap-node.search-hit')).toHaveLength(1)
    clickButton(host, '回忆模式')
    expect(host.querySelectorAll('.mindmap-node.search-hit')).toHaveLength(0)
    expect(input.value).toBe('')
    expect(input.disabled).toBe(true)
  })

  it('leaving recall resets the reveal set (re-entering masks everything again)', () => {
    const host = mountMindMap(TREE)
    clickButton(host, '回忆模式')
    const cover = host.querySelector('.recall-cover')!
    act(() => {
      cover.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelectorAll('.recall-cover')).toHaveLength(1)
    clickButton(host, '回忆模式')
    clickButton(host, '回忆模式')
    expect(host.querySelectorAll('.recall-cover')).toHaveLength(2)
  })
})

describe('MindMap M3.1 跨节点关联线', () => {
  it('renders dashed cross-links with labels; none without conceptLinks', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => {
      render(
        <MindMap
          tree={TREE}
          conceptLinks={[
            { from: '1.1 概念', to: '第二章', label: '对比' },
            { from: '不存在的概念', to: '第二章' }
          ]}
        />,
        host
      )
    })
    expect(host.querySelectorAll('.mindmap-crosslink')).toHaveLength(1)
    expect(host.querySelector('.mindmap-link-label')?.textContent).toBe('对比')
    const plain = mountMindMap(TREE)
    expect(plain.querySelectorAll('.mindmap-crosslink')).toHaveLength(0)
  })
})

describe('MindMap M3.2 焦点模式', () => {
  const dblClickNode = (host: HTMLElement, labelPrefix: string): void => {
    const node = Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node')).find((g) =>
      g.getAttribute('aria-label')?.startsWith(labelPrefix)
    )
    act(() => {
      node?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
  }

  it('double-click re-roots the layout onto the subtree with a breadcrumb', () => {
    const host = mountMindMap(TREE)
    dblClickNode(host, '第一章')
    const rootLabel = host.querySelector('.mindmap-node.root text')?.textContent
    expect(rootLabel).toBe('第一章')
    const crumbs = host.querySelectorAll<HTMLButtonElement>('.mindmap-crumbs button')
    expect(Array.from(crumbs).map((b) => b.textContent)).toEqual(['全图', '第一章'])
    expect(crumbs[1]?.disabled).toBe(true)
  })

  it('collapse state keeps its meaning across focus (全部收起 then drill in)', () => {
    const host = mountMindMap(TREE)
    clickButtonM(host, '全部收起')
    dblClickNode(host, '第一章')
    // In the focus view the root (第一章) itself stays folded → one node only.
    expect(host.querySelectorAll('.mindmap-node')).toHaveLength(1)
    expect(
      Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node'))
        .find((g) => g.getAttribute('aria-label')?.startsWith('第一章'))
        ?.getAttribute('aria-expanded')
    ).toBe('false')
  })

  it('clicking 全图 returns to the whole map with the fold state preserved', () => {
    const host = mountMindMap(TREE)
    clickButtonM(host, '全部收起')
    dblClickNode(host, '第一章')
    const whole = Array.from(host.querySelectorAll('.mindmap-crumbs button')).find((b) => b.textContent === '全图')
    act(() => {
      whole?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelector('.mindmap-node.root text')?.textContent).toBe('根')
    // 第一章 still folded from the pre-focus state.
    expect(
      Array.from(host.querySelectorAll<SVGGElement>('.mindmap-node[role="button"]'))
        .find((g) => g.getAttribute('aria-label')?.startsWith('第一章'))
        ?.getAttribute('aria-expanded')
    ).toBe('false')
  })
})

function clickButtonM(host: HTMLElement, label: string): void {
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)
  act(() => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('批5 关系模式 + PNG 导出（2026-09-17）', () => {
  const CONCEPTS = [
    { term: '学习率', definition: '步长参数，过大震荡过小慢。'.repeat(3), refs: [] },
    { term: '过拟合', definition: '训练高测试低，本质是容量过大。'.repeat(3), refs: [] },
    { term: '正则化', definition: '通过惩罚大权重抑制过拟合的手段。'.repeat(3), refs: [] }
  ]
  const LINKS = [
    { from: '学习率', to: '过拟合', label: '因果' },
    { from: '正则化', to: '过拟合', label: '对比' }
  ]

  function mount(props: Record<string, unknown>): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => render(<MindMap tree={TREE} {...props} />, host))
    return host
  }

  it('有关系边时出现「关系模式」开关；没有时不出现（按下去只会看到空图）', () => {
    const withLinks = mount({ concepts: CONCEPTS, conceptLinks: LINKS })
    const toggle = [...withLinks.querySelectorAll('button')].find((b) => b.textContent === '关系模式')
    expect(toggle).toBeDefined()

    const withoutLinks = mount({ concepts: CONCEPTS, conceptLinks: [] })
    expect([...withoutLinks.querySelectorAll('button')].some((b) => b.textContent === '关系模式')).toBe(false)
  })

  it('切换到关系模式：画出概念节点与全部关系边（不再受 ≤5 条虚线限制）', () => {
    const host = mount({ concepts: CONCEPTS, conceptLinks: LINKS })
    // 切换前是层级树，没有关系层
    expect(host.querySelector('[data-testid="mindmap-relation-layer"]')).toBeNull()
    const toggle = [...host.querySelectorAll('button')].find((b) => b.textContent === '关系模式') as HTMLButtonElement
    act(() => toggle.click())
    const layer = host.querySelector('[data-testid="mindmap-relation-layer"]')
    expect(layer).not.toBeNull()
    // 三个概念节点 + 两条带关系词的边
    expect(layer!.querySelectorAll('.mindmap-relation-node')).toHaveLength(3)
    expect(layer!.querySelectorAll('.mindmap-relation-line')).toHaveLength(2)
    const labels = [...layer!.querySelectorAll('.mindmap-link-label')].map((el) => el.textContent).sort()
    expect(labels).toEqual(['因果', '对比'])
    // 再点一次回到层级树
    act(() => toggle.click())
    expect(host.querySelector('[data-testid="mindmap-relation-layer"]')).toBeNull()
  })

  it('导出 PNG 按钮：只在给了回调时出现，busy 时禁用并显示「导出中…」', () => {
    const idle = mount({ onExportPng: () => undefined })
    const png = [...idle.querySelectorAll('button')].find((b) => b.textContent === '导出 PNG')
    expect(png).toBeDefined()
    expect((png as HTMLButtonElement).disabled).toBe(false)

    const busy = mount({ onExportPng: () => undefined, exportBusy: 'png' })
    const busyBtn = [...busy.querySelectorAll('button')].find((b) => b.textContent === '导出中…')
    expect(busyBtn).toBeDefined()
    expect((busyBtn as HTMLButtonElement).disabled).toBe(true)

    const none = mount({})
    expect([...none.querySelectorAll('button')].some((b) => b.textContent === '导出 PNG')).toBe(false)
  })
})
