import { describe, expect, it, vi } from 'vitest'
import { FeedbackSection } from '../../src/renderer/components/FeedbackSection'
import { mount, click, input } from '../helpers/preact'

describe('FeedbackSection (批5: 笔记反馈润色)', () => {
  it('renders the six preset tags and lets the user multi-select', () => {
    const host = mount(<FeedbackSection busy={false} onSubmit={vi.fn()} />)
    const tags = host.querySelectorAll<HTMLButtonElement>('.feedback-tag')
    expect(tags.length).toBeGreaterThanOrEqual(6)
    click(tags[0])
    click(tags[2])
    expect(tags[0]?.classList.contains('active')).toBe(true)
    expect(tags[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(tags[1]?.classList.contains('active')).toBe(false)
    click(tags[0])
    expect(tags[0]?.classList.contains('active')).toBe(false)
  })

  it('submit stays disabled until a tag or free text is picked, then fires once', () => {
    const onSubmit = vi.fn()
    const host = mount(<FeedbackSection busy={false} onSubmit={onSubmit} />)
    const submit = () => host.querySelector<HTMLButtonElement>('.feedback-actions button')
    expect(submit()?.disabled).toBe(true)
    click(host.querySelector('.feedback-tag'))
    expect(submit()?.disabled).toBe(false)
    click(submit())
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0]![0] as { tags: string[]; text: string }
    expect(payload.tags.length).toBe(1)
    expect(payload.text).toBe('')
  })

  it('free text alone unlocks the submit and is trimmed into the payload', () => {
    const onSubmit = vi.fn()
    const host = mount(<FeedbackSection busy={false} onSubmit={onSubmit} />)
    const textarea = host.querySelector<HTMLTextAreaElement>('.feedback-text')
    input(textarea, '  第 3 节的推导没看懂  ')
    expect(host.querySelector<HTMLButtonElement>('.feedback-actions button')?.disabled).toBe(false)
    click(host.querySelector('.feedback-actions button'))
    expect(onSubmit).toHaveBeenCalledWith({ tags: [], text: '第 3 节的推导没看懂' })
  })

  it('busy state disables every input and relabels the submit', () => {
    const host = mount(<FeedbackSection busy onSubmit={vi.fn()} />)
    expect(host.querySelector<HTMLButtonElement>('.feedback-tag')?.disabled).toBe(true)
    expect(host.querySelector<HTMLTextAreaElement>('.feedback-text')?.disabled).toBe(true)
    const submit = host.querySelector<HTMLButtonElement>('.feedback-actions button')
    expect(submit?.disabled).toBe(true)
    expect(submit?.textContent).toContain('润色中')
  })
})
