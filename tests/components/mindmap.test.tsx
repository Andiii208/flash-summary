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
