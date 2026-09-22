import { describe, expect, it, vi } from 'vitest'
import { QaDock } from '../../src/renderer/components/QaDock'
import { mount, click, input } from '../helpers/preact'

/** 批2 (plan 2026-09-22-wide-screen-blank-space)：坞头多了「追问|目录」tab 段，
    文档序第一个 button 是 tab 而不是「提问」——按文本锁定主行动钮。 */
const askButton = (host: Element): Element | null =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === '提问') ?? null

describe('QaDock', () => {
  it('renders the conversation entries', () => {
    const entries = [{ question: '什么是复杂度？', answer: '复杂度衡量算法效率。' }]
    const host = mount(<QaDock entries={entries} busy={false} hasLesson onAsk={() => undefined} />)
    expect(host.textContent).toContain('什么是复杂度？')
    expect(host.textContent).toContain('复杂度衡量算法效率。')
    // V5 出处着色: answers carry the AI provenance tag.
    expect(host.querySelector('.qa-a .ai-tag')).not.toBeNull()
  })

  it('fires onAsk with the typed question and clears the input', () => {
    const onAsk = vi.fn()
    const host = mount(<QaDock entries={[]} busy={false} hasLesson onAsk={onAsk} />)
    const field = host.querySelector<HTMLTextAreaElement>('textarea.qa-input')
    input(field, '再讲一遍')
    click(askButton(host))
    expect(onAsk).toHaveBeenCalledWith('再讲一遍')
    expect(field?.value).toBe('')
  })

  it('disables submission while busy and shows a pending hint', () => {
    const host = mount(<QaDock entries={[]} busy hasLesson onAsk={() => undefined} />)
    expect((askButton(host) as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('思考中')
  })

  it('locks the input when no lesson is selected instead of silently no-op\'ing', () => {
    const onAsk = vi.fn()
    const host = mount(<QaDock entries={[]} busy={false} hasLesson={false} onAsk={onAsk} />)
    const field = host.querySelector<HTMLTextAreaElement>('textarea.qa-input')
    expect(field?.disabled).toBe(true)
    expect((askButton(host) as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('选择课时后')
    input(field, '这个问题不会被发送')
    click(askButton(host))
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('does not submit while the IME composition is active (批2 A5)', () => {
    const onAsk = vi.fn()
    const host = mount(<QaDock entries={[]} busy={false} hasLesson onAsk={onAsk} />)
    const field = host.querySelector<HTMLTextAreaElement>('textarea.qa-input')
    input(field, '递归复杂度')
    // Preact forwards the native event; happy-dom needs isComposing patched on.
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    field!.dispatchEvent(composing)
    expect(onAsk).not.toHaveBeenCalled()
    // A normal Enter (not composing) submits.
    field!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onAsk).toHaveBeenCalledWith('递归复杂度')
  })

  it('renders the answer as markdown-lite with paragraph breaks (批2 A6)', () => {
    const entries = [{ question: '总结一下', answer: '第一点。\n第二点有 **加粗**。' }]
    const host = mount(<QaDock entries={entries} busy={false} hasLesson onAsk={() => undefined} />)
    const paras = host.querySelectorAll('.qa-a .md-para')
    expect(paras.length).toBeGreaterThanOrEqual(2)
    expect(host.querySelector('.qa-a strong')?.textContent).toBe('加粗')
  })

  it('shows recent cross-lesson exchanges when no lesson is selected (批B)', () => {
    const onOpenLesson = vi.fn()
    const recent = [
      { lessonId: 'l1', question: '什么是复杂度？', answer: '略', createdAt: '2026-09-04T01:00:00Z', courseName: '算法', lessonTitle: '第1节' }
    ]
    const host = mount(<QaDock entries={[]} busy={false} hasLesson={false} onAsk={() => undefined} recent={recent} onOpenLesson={onOpenLesson} />)
    // A3 (plan 2026-09-13): with recent rows below, the «从一条追问开始» hero
    // card is replaced by a one-line lead-in — the card contradicted the list.
    expect(host.querySelector('.qa-dock .empty-state')).toBeNull()
    expect(host.querySelector('.msg')?.textContent).toContain('选择课时后')
    const row = host.querySelector('[data-testid="qa-recent-row"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain('算法 · 第1节')
    expect(row?.textContent).toContain('什么是复杂度？')
    click(row)
    expect(onOpenLesson).toHaveBeenCalledWith('l1')
  })

  it('keeps the plain hint when no lesson is selected and there is no recent QA', () => {
    const host = mount(<QaDock entries={[]} busy={false} hasLesson={false} onAsk={() => undefined} recent={[]} onOpenLesson={() => undefined} />)
    expect(host.querySelector('[data-testid="qa-recent"]')).toBeNull()
    expect(host.textContent).toContain('选择课时后')
  })

  it('renders the optimistic pending bubble with the question, no AI tag yet (批C)', () => {
    const entries = [{ question: '什么是 MUX？', answer: '', pending: true }]
    const host = mount(<QaDock entries={entries} busy hasLesson onAsk={() => undefined} />)
    expect(host.querySelector('[data-testid="qa-pending"]')?.textContent).toContain('思考中')
    expect(host.querySelector('.qa-q')?.textContent).toBe('什么是 MUX？')
    // The answer bubble (and its AI provenance tag) only exists once answered.
    expect(host.querySelector('.qa-a .ai-tag')).toBeNull()
  })

  it('shows only one 思考中 when busy with a pending bubble (批C dedup)', () => {
    const host = mount(<QaDock entries={[{ question: 'q', answer: '', pending: true }]} busy hasLesson onAsk={() => undefined} />)
    expect(host.textContent.split('思考中').length - 1).toBe(1)
  })

  it('renders exchange timestamps as relative labels (批C)', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString()
    const entries = [{ question: 'q', answer: 'a', createdAt: twoHoursAgo }]
    const host = mount(<QaDock entries={entries} busy={false} hasLesson onAsk={() => undefined} />)
    expect(host.querySelector('.qa-time')?.textContent).toBe('2 小时前')
  })

  // P37 (plan 2026-09-21): 无笔记从「软提示照问」改为硬门禁——输入不可用、文案
  // 指引去生成笔记；主侧 qa:ask 同款拒绝（tests/ipc.test.ts 门禁用例）。原批C
  // 用例「without gating input」的行为被用户明确否决，断言随契约改写。
  it('P37: 无笔记的课时输入不可用，并说明请先生成笔记（硬门禁）', () => {
    const onAsk = vi.fn()
    const host = mount(<QaDock entries={[]} busy={false} hasLesson hasNote={false} onAsk={onAsk} />)
    const field = host.querySelector<HTMLTextAreaElement>('textarea.qa-input')
    expect(field?.disabled).toBe(true)
    expect(field?.placeholder).toContain('生成笔记')
    expect(host.textContent).toContain('请先为此课时生成笔记')
    input(field, '这个问题不会被发送')
    click(askButton(host))
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('P36→P39: 根元素是 .qa-dock（单一 fixed 悬浮小卡片形态），带头部收起键', () => {
    const onCollapse = vi.fn()
    const host = mount(<QaDock entries={[]} busy={false} hasLesson onAsk={() => undefined} onCollapse={onCollapse} />)
    expect(host.querySelector('.qa-dock')).not.toBeNull()
    expect(host.querySelector('[data-testid="qa-dock"]')?.getAttribute('aria-label')).toBe('追问')
    expect(host.textContent).toContain('追问')
    const collapse = host.querySelector('.qa-dock-collapse')
    expect(collapse).not.toBeNull()
    click(collapse)
    expect(onCollapse).toHaveBeenCalled()
  })

  // P49-3 (plan 2026-09-22): placeholder 只留单行「针对当前课时提问…」——旧值把
  // Enter/Shift+Enter 也塞进去，窄卡里折成 3 行把输入区撑得又高又挤（Andiii 截图）。
  it('P49-3: placeholder 单行，快捷键说明移到 title', () => {
    const host = mount(<QaDock entries={[]} busy={false} hasLesson onAsk={() => undefined} />)
    const field = host.querySelector<HTMLTextAreaElement>('textarea.qa-input')
    expect(field?.placeholder).toBe('针对当前课时提问…')
    expect(field?.placeholder).not.toContain('Enter')
    expect(field?.title).toContain('Enter')
    expect(field?.title).toContain('Shift+Enter')
  })

  // P45 (plan 2026-09-22-qa-dock-float-window): 用户明示「我本身就在笔记内部针对当前
  // 笔记进行提问，不需要这个课程栏」——坞头只剩「追问 + 收起」，LessonChip 及其在窄卡
  // 里的溢出源一并删除；切课时在侧栏课程树/笔记题头 chip/顶栏面包屑三处都可做。
  // 批2 (plan 2026-09-22-wide-screen-blank-space)：标题被 tab 段（追问|目录）取代，
  // 「追问」作为 tab 首项仍在原地。
  it('P45: 坞头不再渲染课时切换 chip', () => {
    const host = mount(<QaDock entries={[]} busy={false} hasLesson onAsk={() => undefined} onCollapse={() => undefined} />)
    expect(host.querySelector('.qa-dock-head .lesson-chip')).toBeNull()
    expect(host.querySelector('.qa-dock-tabs')?.textContent).toContain('追问')
    expect(host.querySelector('.qa-dock-collapse')).not.toBeNull()
  })
})

describe('QaDock 批2：R1+ 升格（plan 2026-09-22-wide-screen-blank-space）', () => {
  const chapters = [
    { at: 0, title: '绪论', summary: '课程引入' },
    { at: 120, title: '复杂度分析', summary: '渐近记号的推导' },
    { at: 300, title: '摊还分析', summary: '均摊与聚合' }
  ]

  it('坞头是 tab 段（追问/目录），aria 形态完整', () => {
    const host = mount(<QaDock entries={[]} busy={false} hasLesson onAsk={() => undefined} chapters={chapters} />)
    const tablist = host.querySelector('.qa-dock-tabs')
    expect(tablist?.getAttribute('role')).toBe('tablist')
    const tabs = [...host.querySelectorAll('[role="tab"]')]
    expect(tabs.map((t) => t.textContent)).toEqual(['追问', '目录'])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false')
  })

  it('无章节的笔记：目录 tab 禁用并说明原因（不给死按钮）', () => {
    const host = mount(<QaDock entries={[]} busy={false} hasLesson onAsk={() => undefined} />)
    const tocTab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === '目录')
    expect((tocTab as HTMLButtonElement).disabled).toBe(true)
    expect(tocTab?.getAttribute('title')).toContain('没有章节')
  })

  it('切到目录 tab 渲染章节项（时间戳 + 标题），坞内不再显示输入行', () => {
    const host = mount(<QaDock entries={[]} busy={false} hasLesson onAsk={() => undefined} chapters={chapters} />)
    const tocTab = [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === '目录') as HTMLButtonElement
    click(tocTab)
    const items = host.querySelectorAll('[data-testid="qa-toc-item"]')
    expect(items).toHaveLength(3)
    expect(items[1]?.textContent).toContain('复杂度分析')
    expect(items[1]?.textContent).toContain('02:00')
    // 目录态下追问输入区不渲染（互斥视图，不是叠加）。
    expect(host.querySelector('textarea.qa-input')).toBeNull()
  })

  it('空对话 + 有笔记：建议问题由章节标题生成，点击即问', () => {
    const onAsk = vi.fn()
    const host = mount(<QaDock entries={[]} busy={false} hasLesson hasNote onAsk={onAsk} chapters={chapters} />)
    const chips = [...host.querySelectorAll('[data-testid="qa-suggest"] .chip')]
    expect(chips).toHaveLength(3)
    expect(chips[0]?.textContent).toContain('绪论')
    click(chips[0])
    expect(onAsk).toHaveBeenCalledWith('「绪论」讲了什么？')
  })

  it('有对话后不再显示建议问题（不重复入口）', () => {
    const host = mount(<QaDock entries={[{ question: 'q', answer: 'a' }]} busy={false} hasLesson hasNote onAsk={() => undefined} chapters={chapters} />)
    expect(host.querySelector('[data-testid="qa-suggest"]')).toBeNull()
  })

  it('长答案可全宽查看：挂 .fullscreen-overlay 基元 + 可关闭', () => {
    const host = mount(<QaDock entries={[{ question: '长问题', answer: '很长的回答', createdAt: new Date().toISOString() }]} busy={false} hasLesson hasNote onAsk={() => undefined} />)
    expect(host.querySelector('[data-testid="qa-wide"]')).toBeNull()
    click(host.querySelector('[data-testid="qa-wide-open"]'))
    const overlay = host.querySelector('.qa-wide')
    expect(overlay?.className).toContain('fullscreen-overlay')
    expect(overlay?.getAttribute('aria-modal')).toBe('true')
    expect(host.querySelector('[data-testid="qa-wide"]')?.textContent).toContain('很长的回答')
    click(host.querySelector('.qa-wide-head button'))
    expect(host.querySelector('[data-testid="qa-wide"]')).toBeNull()
  })
})

describe('QaPanel 批4 错误反馈', () => {
  it('a failed exchange renders an inline error bubble with a retry that resends the question', () => {
    const onAsk = vi.fn()
    const host = mount(
      <QaDock busy={false} hasLesson onAsk={onAsk} entries={[{ question: '为什么反向传播有效？', answer: '', error: '网络中断', createdAt: new Date().toISOString() }]} />
    )
    const errorBubble = host.querySelector('[data-testid="qa-error"]')
    expect(errorBubble).not.toBeNull()
    expect(errorBubble?.textContent).toContain('回答失败')
    expect(errorBubble?.textContent).toContain('网络中断')
    click(errorBubble!.querySelector('button'))
    expect(onAsk).toHaveBeenCalledWith('为什么反向传播有效？')
  })

  it('the retry button disables while another answer is in flight', () => {
    const host = mount(
      <QaDock busy hasLesson onAsk={() => undefined} entries={[{ question: 'q', answer: '', error: '网络中断' }]} />
    )
    const retry = host.querySelector<HTMLButtonElement>('[data-testid="qa-error"] button')
    expect(retry?.disabled).toBe(true)
  })

  it('busy shows a hint above the input instead of swallowing Enter silently', () => {
    const host = mount(<QaDock entries={[]} busy hasLesson onAsk={() => undefined} />)
    expect(host.querySelector('[data-testid="qa-busy-hint"]')?.textContent).toContain('上一条还在回答中')
  })
})
