import { describe, expect, it } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach } from 'vitest'
import { MindMap, type MindMapProps } from '../../src/renderer/components/MindMap'
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

interface MountBox {
  width: number
  height?: number
}

/** P51: box 传入时在渲染前给容器盒打桩（happy-dom 没有布局，也没 ResizeObserver）——
    measureScale 跑在 useLayoutEffect 里，渲染期间就能读到桩。render 后立即还原原型。 */
function mountMindMap(tree: TreeNode, props: Partial<MindMapProps> = {}, box?: MountBox): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  if (box == null) {
    act(() => render(<MindMap tree={tree} {...props} />, host))
    return host
  }
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const savedWidth = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
  const savedHeight = Object.getOwnPropertyDescriptor(proto, 'clientHeight')
  Object.defineProperty(proto, 'clientWidth', { value: box.width, configurable: true })
  if (box.height != null) Object.defineProperty(proto, 'clientHeight', { value: box.height, configurable: true })
  try {
    act(() => render(<MindMap tree={tree} {...props} />, host))
  } finally {
    if (savedWidth == null) delete proto.clientWidth
    else Object.defineProperty(proto, 'clientWidth', savedWidth)
    if (savedHeight == null) delete proto.clientHeight
    else Object.defineProperty(proto, 'clientHeight', savedHeight)
  }
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
    expect(host.querySelector('.mindmap-crumbs')?.textContent).toContain('返回整图')
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
    // P51: 内部缩放那套（适应窗口/放大/缩小/倍率）已移除，视图组只剩「全图」——
    // 默认挂载不传 onOpenFullMap，所以这里看不到它（见 P51 describe 的用例）。
    expect(labels).toEqual(['全部收起', '展开 L2', '展开 L3', '全部展开', '回忆模式'])
    expect(toolbar!.querySelector('.mindmap-search')).not.toBeNull()
  })

  // P51 (plan 2026-09-22): Andiii「不需要你设置一个内部的放大缩小……用户可以直接点击
  // 全图去看呀」——缩放入口全撤，「全图」只在调用方给回调时出现。
  it('P51: 工具栏没有内部缩放入口，「全图」仅在被提供回调时渲染并可点', () => {
    const withoutCb = mountMindMap(TREE)
    const toolbar = withoutCb.querySelector('[data-testid="mindmap-toolbar"]')!
    expect(Array.from(toolbar.querySelectorAll('button')).map((b) => b.textContent)).not.toContain('全图')
    expect(toolbar.querySelector('[data-testid="mindmap-zoom-in"]')).toBeNull()
    expect(toolbar.querySelector('.mindmap-zoom-label')).toBeNull()
    let opened = 0
    const withCb = mountMindMap(TREE, { onOpenFullMap: () => { opened += 1 } })
    const full = withCb.querySelector<HTMLButtonElement>('[data-testid="mindmap-full-map"]')!
    expect(full?.textContent).toBe('全图')
    act(() => { full.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(opened).toBe(1)
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

  // 批5 (P16): 此前 `searching = matched.size > 0`——零命中时全图原样渲染，
  // 界面毫无变化，用户会以为搜索坏了（全站唯一没有零命中空态的搜索）。
  it('批5 (P16): 搜不到时给一行零命中提示，命中/清空后消失', () => {
    const host = mountMindMap(TREE)
    const empty = (): Element | null => host.querySelector('[data-testid="mindmap-search-empty"]')
    const input = host.querySelector<HTMLInputElement>('.mindmap-search')!
    const type = (value: string): void => {
      act(() => {
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    // 没搜之前不占位。
    expect(empty()).toBeNull()
    type('不存在的节点名')
    expect(empty()).not.toBeNull()
    expect(empty()?.classList.contains('msg')).toBe(true)
    expect(empty()?.textContent).toContain('没有匹配的节点')
    // 有命中 → 提示消失（节点自己会点亮）。
    type('概念')
    expect(host.querySelectorAll('.mindmap-node.search-hit')).toHaveLength(1)
    expect(empty()).toBeNull()
    // 再次零命中 → 回来；清空 → 消失。
    type('还是不存在的名字')
    expect(empty()).not.toBeNull()
    type('')
    expect(empty()).toBeNull()
    // 纯空白视同没搜。
    type('   ')
    expect(empty()).toBeNull()
  })
})

describe('MindMap P51 适合比例（内部缩放/平移已移除）', () => {
  const svgOf = (host: HTMLElement): SVGSVGElement => host.querySelector('svg')!
  const viewBoxOf = (host: HTMLElement): number[] => svgOf(host).getAttribute('viewBox')!.split(/\s+/).map(Number)

  it('没量到容器尺寸时保持 1:1，viewBox 是整幅内容', () => {
    const host = mountMindMap(TREE)
    const svg = svgOf(host)
    const [x, y, w, h] = viewBoxOf(host)
    expect([x, y]).toEqual([0, 0])
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(w!, 4)
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(h!, 4)
  })

  it('fit=width：按容器宽拟合并留 16px 余量——元素盒 ≤ 容器宽−32，宽高同比，viewBox 恒为整幅', () => {
    const probe = mountMindMap(TREE)
    const frameW = viewBoxOf(probe)[2]!
    const frameH = viewBoxOf(probe)[3]!
    const host = mountMindMap(TREE, {}, { width: 400 })
    const svg = svgOf(host)
    const expected = Math.min(1, (400 - 32) / frameW)
    // 元素盒 = 图幅 × 倍率（宽高属性都 Math.round 过，按 ±1px 比）。
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(frameW * expected, 0)
    // 元素盒装得进「容器宽 − 余量×2」：不再有幽灵横滚，也不需要内部滚动。
    expect(Number(svg.getAttribute('width'))).toBeLessThanOrEqual(400 - 32 + 0.5)
    // 等比：高度按同一个倍率跟着长（页面下滑看完，见 CSS：宿主自然高度）。
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(frameH * expected, 0)
    expect(viewBoxOf(host).slice(0, 2)).toEqual([0, 0])
    expect(viewBoxOf(host).slice(2)).toEqual([frameW, frameH])
  })

  it('fit=width：只缩小不放大——小图在宽容器里保持 1:1（节点文字不跟着放大变稀散）', () => {
    const probe = mountMindMap(TREE)
    const frameW = viewBoxOf(probe)[2]!
    const host = mountMindMap(TREE, {}, { width: frameW * 4 + 64 })
    expect(Number(svgOf(host).getAttribute('width'))).toBeCloseTo(frameW, 4)
  })

  it('fit=box：宽高都拟合进容器（全图弹层/课程导图弹层宿主）', () => {
    const probe = mountMindMap(TREE)
    const frameW = viewBoxOf(probe)[2]!
    const frameH = viewBoxOf(probe)[3]!
    const host = mountMindMap(TREE, { fit: 'box' }, { width: 400, height: 300 })
    const svg = svgOf(host)
    const expected = Math.min(1, Math.min((400 - 32) / frameW, (300 - 32) / frameH))
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(frameW * expected, 0)
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(frameH * expected, 0)
    expect(Number(svg.getAttribute('height'))).toBeLessThanOrEqual(300 - 32 + 0.5)
    expect(Number(svg.getAttribute('width'))).toBeLessThanOrEqual(400 - 32 + 0.5)
  })

  it('倍率下限 MIN_SCALE：图大到拟合不出可读尺寸时兜底（fit=box 由容器滚动收尾）', () => {
    const probe = mountMindMap(TREE)
    const frameW = viewBoxOf(probe)[2]!
    const frameH = viewBoxOf(probe)[3]!
    const host = mountMindMap(TREE, { fit: 'box' }, { width: 10, height: 10 })
    const svg = svgOf(host)
    // 0.4 下限：图幅 × 0.4（宽高属性 Math.round 过，按 ±1px 比）。
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(frameW * 0.4, 0)
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(frameH * 0.4, 0)
  })

  it('没有内部缩放监听：Ctrl+滚轮不改变 viewBox（缩放整套已移除）', () => {
    const host = mountMindMap(TREE, {}, { width: 400 })
    const before = viewBoxOf(host)
    const container = host.querySelector('.mindmap-scroll')!
    act(() => {
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 })
      Object.defineProperty(wheel, 'ctrlKey', { value: true })
      container.dispatchEvent(wheel)
    })
    expect(viewBoxOf(host)).toEqual(before)
    expect(container.className).not.toContain('panning')
  })

  it('布局变化后重算适合比例（收起 ⇒ 图变小 ⇒ 仍装进容器）', () => {
    const host = mountMindMap(TREE, {}, { width: 400 })
    const clickButton = (label: string): void => {
      const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)
      act(() => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    }
    const wide = (): number => Number(svgOf(host).getAttribute('width'))
    const before = wide()
    clickButton('全部收起')
    const after = wide()
    // 收起来图更小：要么倍率抬到 1（元素盒=新图宽），要么仍按宽拟合——两者都 ≤ 容器−32
    // 或 =1:1 的原图宽；关键是「装得进容器」这条不变量。
    expect(after).toBeLessThanOrEqual(before + 0.5)
    expect(after).toBeLessThanOrEqual(400 - 32 + 0.5)
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
    expect(Array.from(crumbs).map((b) => b.textContent)).toEqual(['返回整图', '第一章'])
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

  it('clicking 返回整图 returns to the whole map with the fold state preserved', () => {
    const host = mountMindMap(TREE)
    clickButtonM(host, '全部收起')
    dblClickNode(host, '第一章')
    const whole = Array.from(host.querySelectorAll('.mindmap-crumbs button')).find((b) => b.textContent === '返回整图')
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
