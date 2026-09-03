import { describe, expect, it, vi } from 'vitest'
import { QaPanel } from '../../src/renderer/components/QaPanel'
import { mount, click, input } from '../helpers/preact'

describe('QaPanel', () => {
  it('renders the conversation entries', () => {
    const entries = [{ question: '什么是复杂度？', answer: '复杂度衡量算法效率。' }]
    const host = mount(<QaPanel entries={entries} busy={false} hasLesson onAsk={() => undefined} />)
    expect(host.textContent).toContain('什么是复杂度？')
    expect(host.textContent).toContain('复杂度衡量算法效率。')
  })

  it('fires onAsk with the typed question and clears the input', () => {
    const onAsk = vi.fn()
    const host = mount(<QaPanel entries={[]} busy={false} hasLesson onAsk={onAsk} />)
    const field = host.querySelector<HTMLInputElement>('input.qa-input')
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
    const field = host.querySelector<HTMLInputElement>('input.qa-input')
    expect(field?.disabled).toBe(true)
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('选择课时后')
    input(field, '这个问题不会被发送')
    click(host.querySelector('button'))
    expect(onAsk).not.toHaveBeenCalled()
  })
})
