import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 批0（plan 2026-09-18 typography-layout-overhaul）: 排版刻度的钉住测试。
 *
 * 为什么需要它：整改前全站**没有任何间距/行高/字距 token**——gap 有 14 种取值、
 * line-height 11 种、letter-spacing 6 种，全是逐处手写；而 token 层里还躺着一个
 * 被引用却从未定义的 `--font-size-base`（`.dialog-title` 因此静默失效，全应用弹窗
 * 标题与正文同号）。这两类问题靠人眼审 CSS 是查不住的，所以在这里钉死机制：
 *
 *   1. 每个 `var(--x)` 都必须在 :root（或暗色 token 块）里定义过；
 *   2. gap / line-height / letter-spacing 只能取刻度 token（gap:0 例外）；
 *   3. 刻度本身的取值不许漂移（新增档位必须同时改这里，即改刻度要过审）。
 *
 * 断言的是**机制与纪律**，不是具体像素审美——换刻度值请连这里一起改。
 */

const repoRoot = join(__dirname, '..')
const css = readFileSync(join(repoRoot, 'src/renderer/style.css'), 'utf8')

/** 去掉注释（保留换行，便于报行号）。 */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/** 行号（1-based）查找。 */
function lineOf(index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (css[i] === '\n') line++
  return line
}

/** 收集所有 `var(--name)` 引用（含带 fallback 的 `var(--name, x)`）。 */
function referencedTokens(text: string): Array<{ name: string; line: number }> {
  const out: Array<{ name: string; line: number }> = []
  const re = /var\(\s*(--[a-zA-Z0-9-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) != null) out.push({ name: m[1], line: lineOf(m.index) })
  return out
}

/** 收集定义处的 token 名。 */
function definedTokens(text: string): Set<string> {
  const out = new Set<string>()
  const re = /(--[a-zA-Z0-9-]+)\s*:/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) != null) out.add(m[1])
  return out
}

const SPACE_TOKENS: Record<string, string> = {
  '--space-hair': '2px',
  '--space-1': '4px',
  '--space-icon': '6px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-5': '24px'
}
const LEADING_TOKENS: Record<string, string> = {
  '--leading-none': '1',
  '--leading-tight': '1.3',
  '--leading-snug': '1.5',
  '--leading-normal': '1.6',
  '--leading-relaxed': '1.7',
  '--leading-loose': '1.85',
  '--leading-loose-dark': '1.95'
}
const TRACKING_TOKENS: Record<string, string> = {
  '--tracking': '0.5px',
  '--tracking-wide': '1px',
  '--tracking-seal': '3px'
}

/** 某个 token 在 :root 里的字面值。 */
function tokenValue(name: string): string | null {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(stripped)
  return m == null ? null : m[1].trim()
}

/** 运行期内联注入的 token（CSS 里写 var(--x, fallback)，值由渲染层按课程 id 给）。
 *  这是内联样式的正确用法，不是死引用——但要断言注入点还在，白名单不许烂。 */
const RUNTIME_INJECTED: Array<{ name: string; injectedIn: string[] }> = [
  { name: '--course-ink', injectedIn: ['src/renderer/components/CourseTree.tsx', 'src/renderer/components/CourseBrowser.tsx'] }
]

describe('排版刻度（批0）', () => {
  it('每个 var(--x) 引用都有定义——不再有 --font-size-base 这类静默失效', () => {
    const defined = definedTokens(stripped)
    for (const injected of RUNTIME_INJECTED) defined.add(injected.name)
    const missing = referencedTokens(stripped)
      .filter((r) => !defined.has(r.name))
      .map((r) => `${r.name} @ style.css:${r.line}`)
    expect(missing, `未定义的 token 引用：\n${missing.join('\n')}`).toEqual([])
  })

  it('运行期内联 token 的注入点仍在（白名单不腐烂）', () => {
    for (const { name, injectedIn } of RUNTIME_INJECTED) {
      for (const rel of injectedIn) {
        const source = readFileSync(join(repoRoot, rel), 'utf8')
        expect(source, `${rel} 必须仍然注入 ${name}`).toContain(name)
      }
    }
  })

  it('间距刻度存在且取值未漂移', () => {
    for (const [name, value] of Object.entries(SPACE_TOKENS)) {
      expect(tokenValue(name), `${name} 必须是 ${value}`).toBe(value)
    }
  })

  it('行高刻度存在且取值未漂移', () => {
    for (const [name, value] of Object.entries(LEADING_TOKENS)) {
      expect(tokenValue(name), `${name} 必须是 ${value}`).toBe(value)
    }
  })

  it('字距刻度存在且取值未漂移', () => {
    for (const [name, value] of Object.entries(TRACKING_TOKENS)) {
      expect(tokenValue(name), `${name} 必须是 ${value}`).toBe(value)
    }
  })

  it('gap 只能是刻度 token（gap: 0 表示「无间隙」，允许）', () => {
    const bad: string[] = []
    const re = /\bgap\s*:\s*([^;}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) != null) {
      const value = m[1].trim()
      if (value === '0') continue
      const parts = value.split(/\s+/)
      const ok = parts.every((p) => /^var\(--space-[a-z0-9-]+\)$/.test(p) || p === '0')
      if (!ok) bad.push(`${value} @ style.css:${lineOf(m.index)}`)
    }
    expect(bad, `gap 未走刻度：\n${bad.join('\n')}`).toEqual([])
  })

  it('line-height 只能是刻度 token', () => {
    const bad: string[] = []
    const re = /\bline-height\s*:\s*([^;}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) != null) {
      const value = m[1].trim()
      if (!/^var\(--leading-[a-z-]+\)$/.test(value)) bad.push(`${value} @ style.css:${lineOf(m.index)}`)
    }
    expect(bad, `line-height 未走刻度：\n${bad.join('\n')}`).toEqual([])
  })

  it('letter-spacing 只能是刻度 token', () => {
    const bad: string[] = []
    const re = /\bletter-spacing\s*:\s*([^;}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) != null) {
      const value = m[1].trim()
      if (!/^var\(--tracking(-[a-z]+)?\)$/.test(value)) bad.push(`${value} @ style.css:${lineOf(m.index)}`)
    }
    expect(bad, `letter-spacing 未走刻度：\n${bad.join('\n')}`).toEqual([])
  })

  it('--space-icon 是「图标↔文字」专用档，引用处必须能被点名（防止被当成通用 6px）', () => {
    // 只允许出现在明确的图标/标签容器上：按钮、复选框行、chip、树折叠头、例子标签、二维码。
    const allowed = /\.(btn|lesson-chip-btn|dialog-check|tree-toggle|concept-example|bili-qr|capability-check|study-group-head)\b/
    const bad: string[] = []
    const blocks = stripped.split('}')
    let offset = 0
    for (const block of blocks) {
      if (block.includes('var(--space-icon)')) {
        const sel = block.split('{')[0].replace(/\s+/g, ' ').trim()
        if (!allowed.test(sel)) bad.push(`${sel} @ style.css:${lineOf(offset)}`)
      }
      offset += block.length + 1
    }
    expect(bad, `--space-icon 用在了非图标↔文字处：\n${bad.join('\n')}`).toEqual([])
  })
})

/** 取某条规则的声明体（第一个匹配的块）。 */
function bodyOf(selector: string): string {
  const re = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  const m = re.exec(stripped)
  expect(m, `style.css 必须定义 ${selector}`).not.toBeNull()
  return m![1].replace(/\s+/g, ' ')
}

describe('窄窗断点与弹窗高度（批5）', () => {
  it('弹窗有高度钳制、且滚动区只有一个（.dialog-body）', () => {
    expect(bodyOf('.dialog')).toContain('max-height: 86vh')
    expect(bodyOf('.dialog-body')).toContain('overflow-y: auto')
  })

  it('四处散落的滚动预算已清（否则会出现双层滚动条）', () => {
    for (const sel of ['.consent-body', '.legal-scroll', '.feedback-body', '.note-upgrade-list']) {
      expect(bodyOf(sel), `${sel} 不该再自带 max-height`).not.toContain('max-height')
    }
  })

  it('全站只有两个宽度断点：1180（装不下 860）与 1024（装不下 640）', () => {
    const breakpoints = [...stripped.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => m[1])
    expect([...new Set(breakpoints)].sort()).toEqual(['1024', '1180'])
  })
})

describe('长内容反截断合同（批4）', () => {
  it('报错原文（含长 URL/JSON）所在的两处容器都允许任意断行', () => {
    expect(bodyOf('.qa-error-msg')).toContain('overflow-wrap: anywhere')
    expect(bodyOf('.error-boundary p')).toContain('overflow-wrap: anywhere')
  })
})

describe('首启与空库的排版合同（批2）', () => {
  it('.empty-actions 允许换行——否则窄容器里的中文按钮会被逐字换行', () => {
    expect(bodyOf('.empty-actions')).toContain('flex-wrap: wrap')
  })

  it('.btn 标签一律不折行（容器负责换行）', () => {
    expect(bodyOf('.btn')).toContain('white-space: nowrap')
  })

  it('首启引导的按钮在侧栏里整宽竖排（269px 塞不下三个横排按钮）', () => {
    expect(stripped).toContain('.sidebar .empty-actions { flex-direction: column')
    expect(stripped).toContain('.sidebar .empty-actions .btn { width: 100%')
  })

  it('升级旧笔记弹窗不再让列表顶出弹窗外框（min-width 比内容盒还宽的旧账）', () => {
    expect(bodyOf('.note-upgrade-list')).not.toContain('min-width')
    expect(stripped).toContain('.dialog:has(.note-upgrade-list)')
  })
})
