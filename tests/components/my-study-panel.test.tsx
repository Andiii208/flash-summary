import { describe, expect, it, vi } from 'vitest'
import { MyStudyPanel } from '../../src/renderer/components/MyStudyPanel'
import { mount, click } from '../helpers/preact'
import type { CourseTreeInfo } from '../../src/shared/bridge'

const STUDIED: CourseTreeInfo[] = [
  { id: 'c1', name: '网络信息编程', hasExtracted: true, noteCount: 2, lastTaskAt: '2026-09-03T01:30:00Z', lessons: [{ id: 'l1', title: '第五讲', hasNote: true }] }
]
const PINNED: CourseTreeInfo[] = [{ id: 'c2', name: 'Python语言设计', isMine: true, lessons: [] }]
const SAME: CourseTreeInfo[] = [{ id: 'c9', name: 'Python语言设计（李骏扬班）', subjCode: 'CS101', lessons: [] }]

function baseProps(overrides: Partial<Parameters<typeof MyStudyPanel>[0]> = {}): Parameters<typeof MyStudyPanel>[0] {
  return {
    mine: [],
    extracted: [],
    sameCourses: [],
    selectedLesson: '',
    expanded: new Set<string>(),
    onToggle: () => undefined,
    onSelect: () => undefined,
    onHarvestLessons: () => undefined,
    onToggleMine: () => undefined,
    ...overrides
  }
}

describe('MyStudyPanel (M2 批 A: 我的学习聚合区)', () => {
  it('shows one actionable hint when all three groups are empty', () => {
    const host = mount(<MyStudyPanel {...baseProps()} />)
    expect(host.textContent).toContain('我的学习')
    expect(host.textContent).toContain('星标收藏')
    expect(host.querySelectorAll('.course-head')).toHaveLength(0)
  })

  it('renders the extracted group first with course rows', () => {
    const host = mount(<MyStudyPanel {...baseProps({ extracted: STUDIED })} />)
    const heads = [...host.querySelectorAll('h3')].map((h) => h.textContent)
    expect(heads[0]).toContain('我的学习')
    expect(heads[1]).toContain('已提取')
    expect(heads[1]).toContain('1')
    expect(host.querySelectorAll('.course-head')).toHaveLength(1)
  })

  it('shows the same-course recommendation group only when it has content', () => {
    const withSame = mount(<MyStudyPanel {...baseProps({ mine: PINNED, sameCourses: SAME })} />)
    expect(withSame.textContent).toContain('同课其他老师')
    expect(withSame.textContent).toContain('李骏扬班')
    const withoutSame = mount(<MyStudyPanel {...baseProps({ mine: PINNED })} />)
    expect(withoutSame.textContent).not.toContain('同课其他老师')
    // F1: 星标语义是「收藏」——平台课表与实际上课有出入，不做自动同步。
    expect(withSame.textContent).toContain('我的收藏')
    expect(withSame.textContent).not.toContain('我的课程')
  })

  it('collapses a group only once it holds two or more courses (F2)', () => {
    const two: CourseTreeInfo[] = [
      { id: 'e1', name: '课一', hasExtracted: true, lessons: [] },
      { id: 'e2', name: '课二', hasExtracted: true, lessons: [] }
    ]
    const host = mount(<MyStudyPanel {...baseProps({ extracted: two })} />)
    const head = host.querySelectorAll('h3')[1]!
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelectorAll('.course-head')).toHaveLength(2)
    click(head)
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('.course-head')).toHaveLength(0)

    // 0/1 门课不值得折叠。
    const single = mount(<MyStudyPanel {...baseProps({ extracted: STUDIED })} />)
    expect(single.querySelectorAll('h3')[1]!.getAttribute('aria-expanded')).toBeNull()
  })

  it('forwards pin toggles from the embedded course rows', () => {
    const onToggleMine = vi.fn()
    const host = mount(<MyStudyPanel {...baseProps({ extracted: STUDIED, onToggleMine })} />)
    click(host.querySelector('.pin-btn'))
    expect(onToggleMine).toHaveBeenCalledWith('c1', true)
  })
})
