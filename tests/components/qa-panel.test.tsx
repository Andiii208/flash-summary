import { describe, expect, it, vi } from 'vitest'
import { QaPanel } from '../../src/renderer/components/QaPanel'
import { mount, click, input } from '../helpers/preact'

describe('QaPanel', () => {
  it('renders the conversation entries', () => {
    const entries = [{ question: '什么是复杂度？', answer: '复杂度衡量算法效率。' }]
    const host = mount(<QaPanel entries={entries} busy={false} hasLesson onAsk={() => undefined} />)
    expect(host.textContent).toContain('什么是复杂度？')
    expect(host.textContent).toContain('复杂度衡量算法效率。')
    // V5 出处着色: answers carry the AI provenance tag.
    expect(host.querySelector('.qa-a .ai-tag')).not.toBeNull()
  })

  it('fires onAsk with the typed question and clears the input', () => {
    const onAsk = vi.fn()
    const host = mount(<QaPanel entries={[]} busy={false} hasLesson onAsk={onAsk} />)
    const field = host.querySelector<HTMLTextAreaElement>('textarea.qa-input')
    input(field, '再讲一遍')
    click(host.querySelector('button'))
    expect(onAsk).toHaveBeenCalledWith('再讲一遍')
    expect(field?.value).toBe('')
  })

  it('disables submission while busy and shows a pending hint', () => {
    const host = mount(<QaPanel entries={[]} busy hasLesson onAsk={() => undefined} />)
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('思考中')
  })

  it('locks the input when no lesson is selected instead of silently no-op\'ing', () => {
    const onAsk = vi.fn()
    const host = mount(<QaPanel entries={[]} busy={false} hasLesson={false} onAsk={onAsk} />)
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
    const host = mount(<QaPanel entries={[]} busy={false} hasLesson onAsk={onAsk} />)
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
    const host = mount(<QaPanel entries={entries} busy={false} hasLesson onAsk={() => undefined} />)
    const paras = host.querySelectorAll('.qa-a .md-para')
    expect(paras.length).toBeGreaterThanOrEqual(2)
    expect(host.querySelector('.qa-a strong')?.textContent).toBe('加粗')
  })

  it('shows recent cross-lesson exchanges when no lesson is selected (批B)', () => {
    const onOpenLesson = vi.fn()
    const recent = [
      { lessonId: 'l1', question: '什么是复杂度？', answer: '略', createdAt: '2026-09-04T01:00:00Z', courseName: '算法', lessonTitle: '第1节' }
    ]
    const host = mount(<QaPanel entries={[]} busy={false} hasLesson={false} onAsk={() => undefined} recent={recent} onOpenLesson={onOpenLesson} />)
    const row = host.querySelector('[data-testid="qa-recent-row"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain('算法 · 第1节')
    expect(row?.textContent).toContain('什么是复杂度？')
    click(row)
    expect(onOpenLesson).toHaveBeenCalledWith('l1')
  })

  it('keeps the plain hint when no lesson is selected and there is no recent QA', () => {
    const host = mount(<QaPanel entries={[]} busy={false} hasLesson={false} onAsk={() => undefined} recent={[]} onOpenLesson={() => undefined} />)
    expect(host.querySelector('[data-testid="qa-recent"]')).toBeNull()
    expect(host.textContent).toContain('选择课时后')
  })
})
