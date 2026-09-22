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
    // 批3 (plan 2026-09-22, P40): .qa-time 是答案气泡内的元信息行，与答案之间的 6px
    // 随本批归 --space-icon（原裸 6px）——点名允许；别处再引 --space-icon 仍要过审。
    const allowed = /\.(btn|lesson-chip-btn|dialog-check|tree-toggle|concept-example|bili-qr|capability-check|study-group-head|qa-time)\b/
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

  it('全站宽度断点：窄窗只有 1180/1024，宽屏零 min-width 断点', () => {
    const narrow = [...stripped.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => m[1])
    expect([...new Set(narrow)].sort()).toEqual(['1024', '1180'])
    const wide = [...stripped.matchAll(/@media\s*\(min-width:\s*(\d+)px\)/g)].map((m) => m[1])
    // P28：批6 的 1600 宽屏档已删（缩放把 CSS 视口钉在 1600，永不可命中）；
    // P39：坞档 1400 随 2026-09-22「右侧悬浮小卡片」方案取消（SKILL §3）——
    // 坞改单一 fixed 形态，宽屏方向从此零 min-width 断点。加档要过审。
    expect([...new Set(wide)].sort(), '宽屏方向不得再有 min-width 断点（用窗口缩放代替）').toEqual([])
  })

  it('坞不依赖任何断点——也不再用 :has() 把内容面板拉宽', () => {
    // 2026-09-22 P39（SKILL §5）：单一 fixed 悬浮小卡片、无断点；与上一条等价地
    // 复述「宽屏零 min-width」。另钉住 :has(.qa-dock) 拉伸规则已删、正文列 640
    // 回归 --content-max。
    expect(/@media\s*\(min-width:/.test(stripped), '坞不得依赖任何 min-width 断点').toBe(false)
    expect(stripped.includes(':has(.qa-dock)'), '不得再用 :has(.qa-dock) 拉伸面板').toBe(false)
    expect(
      /\.note-viewer\s*\{[^}]*max-width:\s*var\(--content-max\)/.test(stripped),
      '.note-viewer 的阅读列 640 回归 --content-max'
    ).toBe(true)
  })
})

/**
 * 批4 (plan 2026-09-20, P9/D5): 近全屏模态基元。四个自绘 overlay 此前各自手写
 * 同一套层语法（position/inset/z-index/--scrim/居中），第四个「我的学习」本该是
 * 第五份手写。成员只挂选择器；被基元接管的属性不得再出现在成员自己的规则里。
 */
describe('近全屏模态基元（批4）', () => {
  /** 该选择器是否还自有一条规则（`选择器 {`，行首起算）。 */
  const hasOwnRule = (selector: string): boolean =>
    new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`).test(stripped)

  it('四个自绘 overlay 共用一条基元规则，成员不再各自声明定位/遮罩/内边距', () => {
    // 基元是多选择器列表（bodyOf 只认单选择器），这里自己取声明体。
    const m = /(?:^|\n)\s*\.fullscreen-overlay[^{]*\{([^}]*)\}/.exec(stripped)
    expect(m, 'style.css 必须定义 .fullscreen-overlay 基元').not.toBeNull()
    const body = m![1].replace(/\s+/g, ' ')
    expect(body).toContain('position: fixed')
    expect(body).toContain('z-index: 40')
    expect(body).toContain('background: var(--scrim)')
    expect(body).toContain('padding: var(--space-3)')
    for (const sel of ['.course-browser-overlay', '.course-map-overlay', '.bili-dialog-overlay']) {
      expect(stripped, `${sel} 必须在基元的选择器列表里`).toContain(sel)
      expect(hasOwnRule(sel), `${sel} 不该再自写一条覆盖层规则（成员只挂选择器）`).toBe(false)
    }
    // 全站只剩这一处 z-index: 40（此前三处逐字重复 + 新增一处）。
    expect((stripped.match(/z-index: 40/g) ?? []).length).toBe(1)
  })

  it('共享确认弹层是另一档（z-index 60、grid 居中），不并入这个基元', () => {
    const body = bodyOf('.dialog-backdrop')
    expect(body).toContain('z-index: 60')
    expect(body).not.toContain('z-index: 40')
  })
})

describe('长内容反截断合同（批4）', () => {
  it('报错原文（含长 URL/JSON）所在的两处容器都允许任意断行', () => {
    expect(bodyOf('.qa-error-msg')).toContain('overflow-wrap: anywhere')
    expect(bodyOf('.error-boundary p')).toContain('overflow-wrap: anywhere')
  })
})

/**
 * 批6 (plan 2026-09-20-ux-issues-remediation, P10/D6): 阅读列铁律。
 * 导图视图此前是五个视图里唯一的破格者（`.note-body[data-view='mindmap']
 * { max-width: none }`，正文列从 640 撑到 860 面板轴），用户原话「没跟前面几个
 * 板块保持一致、溢出了」。破格已删，这里钉住「没有例外」这条口径——大地图的横向
 * 滚动交给画布内部（元素盒随缩放），不再靠放宽正文列解决。
 */
describe('正文列铁律（批6，P10/D6）', () => {
  it('正文列是 640，且没有任何视图再破格到面板轴', () => {
    expect(bodyOf('.note-body')).toContain('max-width: 640px')
    // 导图视图的破格规则已删（P10）。批6 6.3 起该选择器用于**宿主高度**，所以这里
    // 钉的是「所有 data-view 规则都不得再动列宽」而不是「选择器不许出现」。
    const blocks = stripped.split('}').filter((block) => block.includes("data-view='mindmap'"))
    expect(blocks.length, '导图宿主的确定高度规则应存在（批6 6.3）').toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block, `导图视图不得再破格列宽：${block.split('{')[0].trim()}`).not.toContain('max-width')
    }
  })
})

// P29 (plan 2026-09-21): 荧光笔底色走 token（浅/暗各一份定义在 :root），
// 屏幕与 PDF 两份规则体同值——「同一角色只允许一处定义」的纪律。
describe('荧光笔底色（P29）', () => {
  it('.md-lite mark 用 --mark-bg token，且浅/暗两套主题都定义了它', () => {
    expect(bodyOf('.md-lite mark')).toContain('background: var(--mark-bg)')
    const defs = [...stripped.matchAll(/--mark-bg:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(defs.length, '浅色 + 暗色各一份定义').toBe(2)
    for (const value of defs) expect(value).toMatch(/^rgba\(/)
  })
})

/**
 * 批8 (plan 2026-09-19): padding 刻度基线。SKILL §1 纪律要求 padding 也走
 * --space-* 刻度，但存量攒了一批逐处手写的野值（gap/line-height/letter-spacing
 * 早已收口，padding 一直没管）。一刀切会制造大片红，务实路径 = 基线 allowlist
 * 「只减不增」：
 *   - style.css 出现 allowlist 之外的野值 → 红（新增野值必须过审）；
 *   - allowlist 里的值在 style.css 里已不存在 → 红（修一条就删一条）。
 * 更新 allowlist：`node scripts/style-padding-baseline.mjs`（打印当前清单）。
 */
const KNOWN_PADDING_VIOLATIONS: Record<string, string> = {
  '0 2px': '存量：侧栏头/树元信息（.sidebar-head/.tree-meta）',
  '0 4px': '存量：AI 标签（.ai-tag）',
  '0 6px': '存量：缩略图原图钮（.thumb-origin）',
  '0 9px 7px 27px': '存量：课程副标题（.course-sub）',
  '10px 6px 2px 0': '存量：声明正文（.consent-body）',
  '10px': '存量：反馈正文/B站预览（.feedback-body/.bili-preview）',
  '12px 2px 0': '存量：手动兜底（.manual-fallback）',
  '12px': '存量：反馈块（.feedback-block 的 padding-top）——批4 起覆盖层走 .fullscreen-overlay 基元',
  '14px': '存量：B站二维码（.bili-qr）',
  '16px': '存量：课程浏览卡/导图卡/我的学习卡（.course-browser-card/.course-map-card/.my-study-card）',
  '18px 0 8px': '存量：空态当前行（.note-empty-current）',
  '18px 20px': '存量：弹窗（.dialog）',
  '18px': '存量：Provider 说明/B站对话框卡（.provider-cap-notes/.bili-dialog-card）',
  '1px 5px': '存量：行内代码（.md-lite code 等）',
  '1px 8px': '存量：证据折叠/时间戳（.evidence-fold/.timeline-stamp）',
  '20px': '存量：引导步骤/Markdown 列表（.guide-steps/.md-lite .md-list）',
  '24px': '存量：空课程行（.lesson-row.empty 的 padding-left）——批4 起覆盖层走 .fullscreen-overlay 基元',
  '27px': '存量：课程卡副题（.course-card-sub）',
  '2px 10px': '存量：toast 动作/目录项（.toast-action/.toc-item）',
  '2px 5px': '存量：面包屑（.crumb）',
  '2px': '存量：浏览主体/阶段步（.course-browser-body/.stage-step）',
  '32px': '存量：声明首屏（.consent-boot）',
  '3px 0 5px 7px': '存量：课程树行（.item.course-item）',
  '3px 10px': '存量：导图搜索（.mindmap-search）',
  '3px 8px': '存量：品牌区（.brand）',
  '3px': '存量：toast 关闭钮（.toast-close）',
  '4px 10px 4px 0': '存量：法律滚动区（.legal-scroll）',
  '4px 11px': '存量：课时 chip 钮（.lesson-chip-btn）',
  '4px 12px': '存量：运行 pill/会话徽章（.running-pill/.session-badge）',
  '4px 2px': '存量：笔记库组头（.note-library-group-head）',
  '4px': '存量：chip 菜单/课程卡课时（.lesson-chip-menu/.course-card-lessons）',
  '5px 8px': '存量：Markdown 表格单元（.md-table th/td）',
  '5px 9px': '存量：证据图注（.evidence-fig figcaption）',
  '6px 0': '存量：Provider 添加 summary（.provider-add summary）',
  '6px 10px 6px 24px': '存量：课程行（.lesson-row）',
  '6px 10px': '存量：时间线引文（.timeline-quote）',
  '6px 12px': '存量：Markdown 引文（.md-lite .md-quote）',
  '6px': '存量：课程卡空课时/追问答案（.course-card-lessons-empty/.quiz-answer）',
  '7px 10px': '存量：chip 菜单按钮（.lesson-chip-menu button）',
  '8px 10px': '存量：全部课程头/反馈输入（.all-courses-head/.feedback-text）',
  '8px 11px': '存量：任务错误（.task-error）——追问输入 .qa-input 批3 已归 var(--space-2) var(--space-3)',
  '8px 12px': '存量：搜索框/设置加载错误（.search-input/.settings-load-error）',
  '8px': '存量：折叠侧栏等 5 处（.sidebar.collapsed 等）',
  '9px 18px 9px 14px': '存量：toast（.toast）'
}

/** 与 scripts/style-padding-baseline.mjs 同一把尺：值必须完全由 --space-* token（或 0）组成。 */
function paddingOnScale(value: string): boolean {
  return value.split(/\s+/).every((p) => /^var\(--space-[a-z0-9-]+\)$/.test(p) || p === '0')
}

describe('padding 刻度基线（批8，allowlist 只减不增）', () => {
  it('padding 声明只能取刻度 token——存量野值必须在 allowlist 内，新增野值即红', () => {
    const bad: string[] = []
    const re = /\bpadding(-top|-right|-bottom|-left|-block|-inline|-block-start|-block-end|-inline-start|-inline-end)?\s*:\s*([^;}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) != null) {
      const value = m[2].trim()
      if (paddingOnScale(value)) continue
      if (!(value in KNOWN_PADDING_VIOLATIONS)) bad.push(`${value} @ style.css:${lineOf(m.index)}`)
    }
    expect(
      bad,
      `padding 出现 allowlist 外的新野值：\n${bad.join('\n')}\n若是有意新增：跑 \`node scripts/style-padding-baseline.mjs\` 打印当前清单，把新值补进 KNOWN_PADDING_VIOLATIONS 并注明归属；若只是顺手修样式，请直接改用 --space-* token。`
    ).toEqual([])
  })

  it('allowlist 只减不增——已修掉的野值必须从清单里删掉', () => {
    const found = new Set<string>()
    const re = /\bpadding(-top|-right|-bottom|-left|-block|-inline|-block-start|-block-end|-inline-start|-inline-end)?\s*:\s*([^;}]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) != null) {
      const value = m[2].trim()
      if (!paddingOnScale(value)) found.add(value)
    }
    const stale = Object.keys(KNOWN_PADDING_VIOLATIONS).filter((v) => !found.has(v))
    expect(
      stale,
      `这些 allowlist 条目在 style.css 里已不存在（修一条就删一条）：\n${stale.join('\n')}\n跑 \`node scripts/style-padding-baseline.mjs\` 可拿到当前清单。`
    ).toEqual([])
  })
})

/**
 * 批3 (plan 2026-09-22-qa-dock-float-window, P40): 坞内排版硬伤收口——
 * 用户「排版有问题」的直接来源（近期行写死 220px、坞头无防挤爆、三条 padding 野值）。
 * 钉住别再回潮：窄坞可用宽约 300px，任何写死宽度/上限都会把气泡或问题列挤爆。
 */
describe('追问坞内防挤爆（批3，P40）', () => {
  it('三条 padding 归 token；.task-error 的 8px 11px 是有意保留的存量', () => {
    expect(bodyOf('.qa-a')).toContain('padding: var(--space-3) var(--space-4)')
    expect(bodyOf('.qa-q')).toContain('padding: var(--space-2) var(--space-3)')
    expect(bodyOf('.qa-input')).toContain('padding: var(--space-2) var(--space-3)')
    expect(bodyOf('.task-error')).toContain('padding: 8px 11px')
  })

  it('近期行不写死 220px——「在哪」可压缩带 45% 帽，「问什么」保持 flex:1 省略', () => {
    const where = bodyOf('.qa-recent-where')
    expect(where).toContain('flex: 0 1 auto')
    expect(where).toContain('min-width: 0')
    expect(where).toContain('max-width: 45%')
    expect(where).toContain('text-overflow: ellipsis')
    expect(stripped).not.toContain('flex: 0 0 220px')
    const q = bodyOf('.qa-recent-q')
    expect(q).toContain('flex: 1')
    expect(q).toContain('min-width: 0')
  })

  // P45 (2026-09-22): 课时切换 chip 按用户明示从坞头删除（切课时归侧栏/题头/面包屑），
  // 原「chip 可压缩」断言随被测对象消失改写为「坞头只剩标题 + 收起，且不残留 chip 规则」。
  it('坞头防挤爆：只剩标题与收起键，min-width:0 兜底保留，无 chip 残留', () => {
    expect(bodyOf('.qa-dock-head')).toContain('min-width: 0')
    expect(stripped).not.toContain('.qa-dock-head .lesson-chip')
  })

  it('气泡拉满坞内可用宽、输入框不顶着内容轴上限', () => {
    expect(bodyOf('.qa-dock .qa-q, .qa-dock .qa-a')).toContain('max-width: 100%')
    expect(bodyOf('.qa-dock .qa-input-row .qa-input')).toContain('min-width: 0')
  })
})

/**
 * 批4 (plan 2026-09-22-qa-dock-float-window, P41): 卡片窗口感细化——只做可验证
 * 小项（D6，不做无实测支撑的大改）：头部分隔线、输入行与 textarea 等高、「对话流
 * ↔ 输入行」间距单点定义、入口钮与卡片同一组定位值、滚动条不新增。
 */
describe('追问坞卡片窗口感（批4，P41）', () => {
  it('头部分隔线：底部 1px --border + padding-bottom --space-2；坞整体 padding 维持 --space-3', () => {
    const head = bodyOf('.qa-dock-head')
    expect(head).toContain('border-bottom: 1px solid var(--border)')
    expect(head).toContain('padding-bottom: var(--space-2)')
    expect(bodyOf('.qa-dock')).toContain('padding: var(--space-3)')
  })

  it('输入行与 textarea 等高：align-items: stretch + 按钮 flex: none；44px/resize 维持', () => {
    expect(bodyOf('.qa-dock .qa-input-row')).toContain('align-items: stretch')
    expect(bodyOf('.qa-dock .qa-input-row .btn')).toContain('flex: none')
    const textarea = bodyOf('textarea.qa-input')
    expect(textarea).toContain('min-height: 44px')
    expect(textarea).toContain('resize: vertical')
  })

  it('对话流↔输入行间距单点定义在坞 gap——.qa-log 基则与坞内覆盖都不再写 margin-bottom', () => {
    expect(bodyOf('.qa-dock')).toContain('gap: var(--space-2)')
    expect(bodyOf('.qa-log')).not.toContain('margin-bottom')
    expect(bodyOf('.qa-dock .qa-log')).not.toContain('margin-bottom')
  })

  it('入口钮与卡片同一组定位值（右缘、垂直居中、同层）——折叠态不另写一套', () => {
    const positionOf = (selector: string): string =>
      ['right', 'top', 'transform', 'z-index']
        .map((prop) => new RegExp(`${prop}\\s*:\\s*([^;}]+)`).exec(bodyOf(selector))?.[1]?.trim() ?? '')
        .join(' | ')
    expect(positionOf('.qa-dock-launcher')).toBe(positionOf('.qa-dock'))
    expect(positionOf('.qa-dock')).toBe('var(--space-5) | 50% | translateY(-50%) | 30')
  })

  it('滚动条不新增：::-webkit-scrollbar 规则仍只有全站那一处，坞日志区复用之', () => {
    expect((stripped.match(/::-webkit-scrollbar\s*\{/g) ?? []).length).toBe(1)
    expect(bodyOf('.qa-dock .qa-log')).toContain('overflow-y: auto')
  })
})

/**
 * P44→P45 (plan 2026-09-22-qa-dock-float-window)：Andiii 2026-09-22 两轮订正——
 * P44「卡片太宽了，我要它窄一点、长一点；不要跟笔记的部分有重叠，只利用笔记右侧空白
 * 那一点位置；还要注意组件溢出和文字溢出」；P45「卡片还不够，要再瘦长一点，并且课程
 * 名字这一栏是溢出的——根本没有必要设置这个课程栏小组件，我本身就在笔记内部针对当前
 * 笔记提问」。落地：① 坞展开时笔记盒收到阅读轴 640（右缘 968），卡片宽公式从 968 以右
 * 算起，任何窗宽零重叠；② 宽 380→320→260 封顶、高 70vh/620→78vh/680→84vh/720；
 * ③ 删除坞内课时切换 chip（QaDock 组件同步瘦身，切课时归侧栏/题头/面包屑）；
 * ④ 溢出防护（气泡长 token 可断行、基则不被破坏）。
 */
describe('追问坞窄长化与零重叠（P44）', () => {
  it('坞展开时笔记盒收到阅读轴 640——右缘止于 968，卡片只落在 968 以右', () => {
    expect(bodyOf('.app-main.qa-dock-open .note-viewer')).toContain('max-width: 640px')
    // 基则不动：折叠坞/非笔记页仍是 860 面板轴。
    expect(/\.note-viewer\s*\{[^}]*max-width:\s*var\(--content-max\)/.test(stripped)).toBe(true)
    // 不得回流成 :has()——契约是 App.tsx 上的 .qa-dock-open 类。
    expect(stripped.includes(':has(.qa-dock)')).toBe(false)
  })

  it('卡片宽 = 笔记右侧空白本身：封顶 260，且公式从阅读列 640 右缘算起（间距 --space-3）', () => {
    const dock = bodyOf('.qa-dock')
    expect(dock).toContain('width: max(200px, min(260px')
    expect(dock).toContain('calc(100vw')
    expect(dock).toContain('640px')
    expect(dock).toContain('var(--space-3)')
  })

  it('「变长一点」两连：max-height 70vh/620 → 78vh/680 → 84vh/720', () => {
    expect(bodyOf('.qa-dock')).toContain('max-height: min(84vh, 720px)')
  })

  it('坞内不得再有课时切换 chip——用户明示「在笔记内部问当前笔记，不需要这个」', () => {
    expect(stripped).not.toContain('.qa-dock-head .lesson-chip')
  })

  it('溢出防护：气泡内长 token（网址/无空格串）可断行，气泡不被顶破', () => {
    const bubble = bodyOf('.qa-dock .qa-q, .qa-dock .qa-a')
    expect(bubble).toContain('max-width: 100%')
    expect(bubble).toContain('overflow-wrap: anywhere')
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
