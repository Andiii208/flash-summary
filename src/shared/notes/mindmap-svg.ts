/**
 * Standalone SVG export of a knowledge tree (M3.3, map expansion 2026-09-05).
 * Pure string builder over the shared layout — forced paper-white palette per
 * note-craft SKILL §6 (PDF 讲义：打印纪律——暗色主题下也强制纸白),
 * mirroring PrintHandout's hardcoded print colors. No dependencies; the only
 * model-sourced strings are XML-escaped before they touch the document.
 */
import type { ConceptLink, TreeNode } from './schema'
import { computeMindMapLayout, sublineFirstBaseline, sublineLinesOf, titleBaseline } from './mindmap-layout'

/** XML-escape text content and attribute values. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Render the tree (always fully expanded, terms sub-lines on) as SVG text. */
export function treeToSvg(tree: TreeNode, links: ConceptLink[], title: string): string {
  const layout = computeMindMapLayout(tree, new Set(), { showTerms: true, links })
  const parts: string[] = []
  parts.push('<?xml version="1.0" encoding="UTF-8"?>')
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
      `viewBox="0 0 ${layout.width} ${layout.height}" font-family='"Microsoft YaHei", "PingFang SC", sans-serif'>`
  )
  parts.push(`<title>${esc(title)}</title>`)
  for (const edge of layout.edges) {
    parts.push(`<path d="${esc(edge.d)}" fill="none" stroke="#b9c4ea" stroke-width="1.8"/>`)
  }
  for (const link of layout.links) {
    parts.push(`<path d="${esc(link.d)}" fill="none" stroke="#9aa6d8" stroke-width="1.4" stroke-dasharray="5 4"/>`)
    if (link.label !== '') {
      const labelWidth = link.label.length * 6.5 + 10
      parts.push(
        `<g transform="translate(${link.lx}, ${link.ly})"><rect x="${-labelWidth / 2}" y="-9" width="${labelWidth}" height="18" rx="9" fill="#f4f5fa" stroke="#dfe3ee"/>` +
          `<text text-anchor="middle" y="3.5" font-size="10" fill="#6a7286">${esc(link.label)}</text></g>`
      )
    }
  }
  for (const node of layout.nodes) {
    const fill = node.depth === 0 ? '#e0e6ff' : '#f4f5fa'
    const stroke = node.depth === 0 ? 'none' : '#e3e6ee'
    const weight = node.depth === 0 ? ' font-weight="700"' : ''
    parts.push(`<g transform="translate(${node.x}, ${node.y})"><rect width="${node.width}" height="${node.height}" rx="8" fill="${fill}" stroke="${stroke}"/>`)
    parts.push(`<text x="12" y="${titleBaseline(node)}" font-size="13" fill="#1f2430"${weight}>`)
    node.lines.forEach((line, i) => parts.push(`<tspan x="12" dy="${i === 0 ? 0 : 18}">${esc(line)}</tspan>`))
    parts.push('</text>')
    if (node.subline !== '') {
      parts.push(`<text x="12" y="${sublineFirstBaseline(node)}" font-size="11" fill="#6a7286">`)
      sublineLinesOf(node).forEach((line, i) => parts.push(`<tspan x="12" dy="${i === 0 ? 0 : 14}">${esc(line)}</tspan>`))
      parts.push('</text>')
    }
    parts.push('</g>')
  }
  parts.push('</svg>')
  return parts.join('')
}
