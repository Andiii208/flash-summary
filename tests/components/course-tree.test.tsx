import { describe, expect, it, vi } from 'vitest'
import { CourseTree } from '../../src/renderer/components/CourseTree'
import { mount, click } from '../helpers/preact'
import type { CourseTreeInfo } from '../../src/shared/bridge'

const TREE: CourseTreeInfo[] = [
  { id: 'c1', name: '数据结构', term: '2026秋', lessons: [{ id: 'l1', title: '第1讲 绪论', hasNote: true }, { id: 'l2', title: '第2讲 线性表', hasNote: false }] },
  { id: 'c2', name: '操作系统', term: '2026秋', lessons: [] }
]

describe('CourseTree', () => {
  it('renders courses and lessons with hasNote badges', () => {
    const host = mount(<CourseTree tree={TREE} selectedLesson="" collapsed={new Set()} onToggle={() => undefined} onSelect={() => undefined} onHarvestLessons={() => undefined} />)
    const heads = host.querySelectorAll('.course-head')
    expect(heads).toHaveLength(2)
    expect(heads[0]!.textContent).toContain('数据结构')
    const rows = host.querySelectorAll('.lesson-row:not(.empty)')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelector('.badge')?.textContent).toContain('已处理')
    expect(rows[1]!.querySelector('.badge')?.textContent).toContain('未处理')
  })

  it('fires onToggle when a collapsed course header is clicked', () => {
    const onToggle = vi.fn()
    const host = mount(<CourseTree tree={TREE} selectedLesson="" collapsed={new Set(['c1'])} onToggle={onToggle} onSelect={() => undefined} onHarvestLessons={() => undefined} />)
    expect(host.querySelectorAll('.lesson-row:not(.empty)')).toHaveLength(0)
    click(host.querySelector('.course-head'))
    expect(onToggle).toHaveBeenCalledWith('c1')
  })

  it('highlights the selected lesson row', () => {
    const host = mount(<CourseTree tree={TREE} selectedLesson="l2" collapsed={new Set()} onToggle={() => undefined} onSelect={() => undefined} onHarvestLessons={() => undefined} />)
    const selected = host.querySelector('.lesson-row.selected')
    expect(selected?.textContent).toContain('第2讲 线性表')
  })

  it('fires onSelect with the lesson id', () => {
    const onSelect = vi.fn()
    const host = mount(<CourseTree tree={TREE} selectedLesson="" collapsed={new Set()} onToggle={() => undefined} onSelect={onSelect} onHarvestLessons={() => undefined} />)
    click(host.querySelector('.lesson-row'))
    expect(onSelect).toHaveBeenCalledWith('l1')
  })

  it('shows an empty hint when there are no courses', () => {
    const host = mount(<CourseTree tree={[]} selectedLesson="" collapsed={new Set()} onToggle={() => undefined} onSelect={() => undefined} onHarvestLessons={() => undefined} />)
    expect(host.textContent).toContain('暂无课程')
  })

  it('offers the harvest action on a course without lessons (V1.3)', () => {
    const onHarvestLessons = vi.fn()
    const host = mount(<CourseTree tree={TREE} selectedLesson="" collapsed={new Set()} onToggle={() => undefined} onSelect={() => undefined} onHarvestLessons={onHarvestLessons} />)
    const harvestButton = host.querySelector('.lesson-row.empty button')
    expect(harvestButton?.textContent).toContain('抓取课时目录')
    click(harvestButton)
    expect(onHarvestLessons).toHaveBeenCalledWith('c2')
  })
})
