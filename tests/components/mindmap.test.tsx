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
    expect(labels).toEqual(['全部收起', '展开 L2', '展开 L3', '全部展开', '重置视图'])
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

  it('zoom clamps at 3x and 重置视图 restores identity', () => {
    const host = mountMindMap(TREE)
    const [, , w0] = viewBoxOf(host)
    for (let i = 0; i < 20; i++) fireWheel(host, { ctrlKey: true, deltaY: -120 })
    expect(viewBoxOf(host)[2]).toBeCloseTo(w0! / 3, 4)
    const reset = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '重置视图')
    act(() => {
      reset?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(viewBoxOf(host)[2]).toBeCloseTo(w0!, 4)
    expect(viewBoxOf(host)[0]).toBe(0)
  })

  it('keyboard +/-/0 zooms and resets while the canvas holds focus', () => {
    const host = mountMindMap(TREE)
    const container = host.querySelector<HTMLElement>('.mindmap-scroll')!
    const [, , w0] = viewBoxOf(host)
    act(() => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
    })
    expect(viewBoxOf(host)[2]).toBeLessThan(w0!)
    act(() => {
      container.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }))
    })
    expect(viewBoxOf(host)[2]).toBeCloseTo(w0!, 4)
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
