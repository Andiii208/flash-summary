import { describe, expect, it, vi } from 'vitest'
import { CourseTree } from '../../src/renderer/components/CourseTree'
import { mount, click } from '../helpers/preact'
import type { CourseTreeInfo } from '../../src/shared/bridge'

const TREE: CourseTreeInfo[] = [
  { id: 'c1', name: '数据结构', term: '2026秋', lessons: [{ id: 'l1', title: '第1讲 绪论', hasNote: true }, { id: 'l2', title: '第2讲 线性表', hasNote: false }] },
  { id: 'c2', name: '操作系统', term: '2026秋', lessons: [] }
]

/** Required C2/C4 props, inert for the base tests. */
function mineDefaults(overrides: { sameCourseIds?: ReadonlySet<string>; onToggleMine?: (id: string, mine: boolean) => void } = {}): {
  sameCourseIds: ReadonlySet<string>
  onToggleMine: (id: string, mine: boolean) => void
} {
  return { sameCourseIds: new Set<string>(), onToggleMine: () => undefined, ...overrides }
}

describe('CourseTree', () => {
  it('renders courses and lessons with hasNote badges', () => {
    const host = mount(<CourseTree tree={TREE} selectedLesson="" searching={false} expanded={new Set(['c1', 'c2'])} onToggle={() => undefined} onSelect={() => undefined} onHarvestLessons={() => undefined} {...mineDefaults()} />)
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
    const host = mount(<CourseTree tree={TREE} selectedLesson="" searching={false} expanded={new Set(['c2'])} onToggle={onToggle} onSelect={() => undefined} onHarvestLessons={() => undefined} {...mineDefaults()} />)
    expect(host.querySelectorAll('.lesson-row:not(.empty)')).toHaveLength(0)
    click(host.querySelector('.course-head'))
    expect(onToggle).toHaveBeenCalledWith('c1')
  })

  it('highlights the selected lesson row', () => {
    const host = mount(<CourseTree tree={TREE} selectedLesson="l2" searching={false} expanded={new Set(['c1', 'c2'])} onToggle={() => undefined} onSelect={() => undefined} onHarvestLessons={() => undefined} {...mineDefaults()} />)
    const selected = host.querySelector('.lesson-row.selected')
    expect(selected?.textContent).toContain('第2讲 线性表')
  })

  it('fires onSelect with the lesson id', () => {
    const onSelect = vi.fn()
    const host = mount(<CourseTree tree={TREE} selectedLesson="" searching={false} expanded={new Set(['c1', 'c2'])} onToggle={() => undefined} onSelect={onSelect} onHarvestLessons={() => undefined} {...mineDefaults()} />)
    click(host.querySelector('.lesson-row'))
    expect(onSelect).toHaveBeenCalledWith('l1')
  })

  it('shows an empty hint when there are no courses', () => {
    const host = mount(<CourseTree tree={[]} selectedLesson="" searching={false} expanded={new Set(['c1', 'c2'])} onToggle={() => undefined} onSelect={() => undefined} onHarvestLessons={() => undefined} {...mineDefaults()} />)
    expect(host.textContent).toContain('暂无课程')
  })

  it('offers the harvest action on a course without lessons (V1.3)', () => {
    const onHarvestLessons = vi.fn()
    const host = mount(<CourseTree tree={TREE} selectedLesson="" searching={false} expanded={new Set(['c1', 'c2'])} onToggle={() => undefined} onSelect={() => undefined} onHarvestLessons={onHarvestLessons} {...mineDefaults()} />)
    const harvestButton = host.querySelector('.lesson-row.empty button')
    expect(harvestButton?.textContent).toContain('抓取课时目录')
    click(harvestButton)
    expect(onHarvestLessons).toHaveBeenCalledWith('c2')
  })

  it('shows the teacher/times/classroom sub line and 同课 badge (C3/C4)', () => {
    const enriched: CourseTreeInfo[] = [
      { id: 'c1', name: 'C++程序设计', term: '2026-2027', courTimes: '周一 第3-4节', classroom: '中山-312', subjCode: 'CS101', lessons: [] },
      { id: 'c9', name: 'C++程序设计（李骏扬班）', term: '2026-2027', subjCode: 'CS101', lessons: [] }
    ]
    const host = mount(
      <CourseTree
        tree={enriched}
        selectedLesson=""
        searching={false}
        expanded={new Set()}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onHarvestLessons={() => undefined}
        {...mineDefaults({ sameCourseIds: new Set(['c9']) })}
      />
    )
    const subs = host.querySelectorAll('.course-sub')
    expect(subs[0]!.textContent).toBe('周一 第3-4节 · 中山-312 · 2026-2027')
    expect(host.querySelector('.badge.same')?.textContent).toContain('同课')
  })

  it('pins and unpins via the star button (C2)', () => {
    const onToggleMine = vi.fn()
    const pinned: CourseTreeInfo[] = [{ ...TREE[0]!, isMine: true }]
    const host = mount(
      <CourseTree
        tree={pinned}
        selectedLesson=""
        searching={false}
        expanded={new Set()}
        onToggle={() => undefined}
        onSelect={() => undefined}
        onHarvestLessons={() => undefined}
        {...mineDefaults({ onToggleMine })}
      />
    )
    const pin = host.querySelector('.pin-btn')
    expect(pin?.classList.contains('pinned')).toBe(true)
    expect(pin?.getAttribute('aria-pressed')).toBe('true')
    expect(pin?.querySelector('svg')).not.toBeNull()
    click(pin)
    expect(onToggleMine).toHaveBeenCalledWith('c1', false)
  })
})
