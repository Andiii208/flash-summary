import { describe, expect, it, vi } from 'vitest'
import { LessonChip } from '../../src/renderer/components/LessonChip'
import { mount, click } from '../helpers/preact'

const LESSONS = [
  { id: 'l3', title: '第3节课' },
  { id: 'l5', title: '第5节课', hasNote: true }
]

describe('LessonChip', () => {
  it('renders the course · lesson identity (批A: you-are-here)', () => {
    const host = mount(<LessonChip courseName="数据结构" lessonTitle="第4讲" />)
    expect(host.querySelector('.lesson-chip-course')?.textContent).toBe('数据结构')
    expect(host.querySelector('.lesson-chip-lesson')?.textContent).toBe('第4讲')
  })

  it('opens the sibling-lesson dropdown and switches on pick (批A)', () => {
    const onSelect = vi.fn()
    const host = mount(
      <LessonChip courseName="数据结构" lessonTitle="第3节课" lessons={LESSONS} currentLessonId="l3" onSelectLesson={onSelect} />
    )
    // No menu before the click.
    expect(host.querySelector('.lesson-chip-menu')).toBeNull()
    click(host.querySelector('.lesson-chip-btn'))
    const items = host.querySelectorAll('.lesson-chip-menu button')
    expect(items).toHaveLength(2)
    expect(items[0]?.classList.contains('active')).toBe(true)
    click(items[1] ?? null)
    expect(onSelect).toHaveBeenCalledWith('l5')
    // Picking closes the menu.
    expect(host.querySelector('.lesson-chip-menu')).toBeNull()
  })

  it('marks noted siblings with the processed badge in the dropdown', () => {
    const host = mount(
      <LessonChip courseName="数据结构" lessonTitle="第3节课" lessons={LESSONS} currentLessonId="l3" onSelectLesson={() => undefined} />
    )
    click(host.querySelector('.lesson-chip-btn'))
    const item = host.querySelectorAll('.lesson-chip-menu button')[1]
    expect(item?.querySelector('.badge.ok')?.textContent).toContain('已处理✓')
  })

  it('stays a passive label without lessons or a select handler', () => {
    const host = mount(<LessonChip courseName="数据结构" lessonTitle="第4讲" />)
    click(host.querySelector('.lesson-chip-btn'))
    expect(host.querySelector('.lesson-chip-menu')).toBeNull()
  })

  it('ignores a click on the already-active lesson', () => {
    const onSelect = vi.fn()
    const host = mount(
      <LessonChip courseName="数据结构" lessonTitle="第3节课" lessons={LESSONS} currentLessonId="l3" onSelectLesson={onSelect} />
    )
    click(host.querySelector('.lesson-chip-btn'))
    click(host.querySelectorAll('.lesson-chip-menu button')[0] ?? null)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('批5: without sibling lessons the chip degrades to a passive span (no dead button)', () => {
    const host = mount(<LessonChip courseName="数据结构" lessonTitle="第4讲" />)
    const chip = host.querySelector('.lesson-chip-btn')
    expect(chip?.tagName).toBe('SPAN')
    expect(chip?.classList.contains('passive')).toBe(true)
    // No caret affordance without a menu.
    expect(host.querySelector('.chip-caret')).toBeNull()
  })
})
