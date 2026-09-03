import { useMemo, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { TreeNode } from '../../shared/notes/schema'
import { computeMindMapLayout, NODE_HEIGHT } from '../../shared/notes/mindmap-layout'

/**
 * Interactive SVG mind map over the note's knowledgeTree (2026-09-04).
 * Nodes with children collapse on click; the layout is a pure shared
 * function so the PDF handout reuses the same geometry.
 */
export function MindMap({ tree }: { tree: TreeNode }): JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const layout = useMemo(() => computeMindMapLayout(tree, collapsed), [tree, collapsed])

  const toggle = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div class="mindmap-scroll" data-testid="mindmap">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`知识导图：${tree.title}`}
      >
        {layout.edges.map((edge) => (
          <path key={`${edge.from}-${edge.to}`} d={edge.d} class="mindmap-edge" fill="none" />
        ))}
        {layout.nodes.map((node) => {
          const isRoot = node.depth === 0
          return (
            <g
              key={node.id}
              class={`mindmap-node depth-${node.depth}${isRoot ? ' root' : ''}${node.collapsed ? ' collapsed' : ''}`}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={node.hasChildren ? () => toggle(node.path) : undefined}
              role={node.hasChildren ? 'button' : undefined}
              aria-expanded={node.hasChildren ? !node.collapsed : undefined}
              aria-label={node.hasChildren ? `${node.title}（点击${node.collapsed ? '展开' : '折叠'}）` : node.title}
            >
              <rect width={node.width} height={NODE_HEIGHT} rx={8} class="mindmap-box" />
              <text x={12} y={NODE_HEIGHT / 2 + 5} class="mindmap-label">
                {truncate(node.title, node.width)}
                {node.collapsed ? ' …' : ''}
              </text>
              {node.collapsed && <circle cx={node.width - 10} cy={NODE_HEIGHT / 2} r={8} class="mindmap-badge" />}
              {node.collapsed && (
                <text x={node.width - 10} y={NODE_HEIGHT / 2 + 4} class="mindmap-badge-text" text-anchor="middle">
                  {childCount(tree, node.path)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** How many descendant titles live under a collapsed path (shown on the badge). */
function childCount(tree: TreeNode, path: string): number {
  let node: TreeNode | null = tree
  for (const step of path.split('/')) {
    if (node == null) return 0
    node = node.children[Number(step)] ?? null
  }
  return node != null ? countLeaves(node) - 1 : 0
}

function countLeaves(node: TreeNode): number {
  if (node.children.length === 0) return 1
  return node.children.reduce((acc, child) => acc + countLeaves(child), 0)
}

function truncate(title: string, boxWidth: number): string {
  const maxChars = Math.floor((boxWidth - 30) / 13)
  return title.length > maxChars ? `${title.slice(0, Math.max(1, maxChars - 1))}…` : title
}
