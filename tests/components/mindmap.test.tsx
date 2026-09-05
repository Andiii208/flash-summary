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
    expect(labels).toEqual(['全部收起', '展开 L2', '展开 L3', '全部展开'])
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
