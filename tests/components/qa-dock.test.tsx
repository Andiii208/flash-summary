import { describe, expect, it, vi } from 'vitest'
import { QaDock } from '../../src/renderer/components/QaDock'
import { mount, click, input } from '../helpers/preact'

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
    click(host.querySelector('button'))
    expect(onAsk).toHaveBeenCalledWith('再讲一遍')
    expect(field?.value).toBe('')
  })

  it('disables submission while busy and shows a pending hint', () => {
    const host = mount(<QaDock entries={[]} busy hasLesson onAsk={() => undefined} />)
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('思考中')
  })

  it('locks the input when no lesson is selected instead of silently no-op\'ing', () => {
    const onAsk = vi.fn()
    const host = mount(<QaDock entries={[]} busy={false} hasLesson={false} onAsk={onAsk} />)
    const field = host.querySelector<HTMLTextAreaElement>('textarea.qa-input')
    expect(field?.disabled).toBe(true)
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('选择课时后')
    input(field, '这个问题不会被发送')
    click(host.querySelector('button'))
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
    click(host.querySelector('button'))
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
