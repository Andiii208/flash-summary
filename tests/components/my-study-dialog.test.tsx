import { describe, expect, it, vi } from 'vitest'
import { act } from 'preact/test-utils'
import { MyStudyDialog } from '../../src/renderer/components/MyStudyDialog'
import { mount, click } from '../helpers/preact'
import type { CourseTreeInfo } from '../../src/shared/bridge'

/**
 * 批4 (plan 2026-09-20, P9/D5): 「我的学习」全屏展开。用户现象是这一区根本没有
 * 可展开的入口/状态/挂载点；弹层形制照抄全屏课程浏览器（滚动锁 + focus trap +
 * Esc + 右上关闭键），面板本体复用 MyStudyPanel。
 */

const STUDIED: CourseTreeInfo[] = [
  {
    id: 'c1',
    name: '网络信息编程',
    hasExtracted: true,
    noteCount: 2,
    lastTaskAt: '2026-09-03T01:30:00Z',
    lessons: [{ id: 'l1', title: '第五讲', hasNote: true }]
  }
]

function baseProps(overrides: Partial<Parameters<typeof MyStudyDialog>[0]> = {}): Parameters<typeof MyStudyDialog>[0] {
  return {
    open: true,
    mine: [],
    extracted: STUDIED,
    sameCourses: [],
    selectedLesson: '',
    expanded: new Set<string>(['c1']),
    onToggle: () => undefined,
    onSelect: () => undefined,
    onHarvestLessons: () => undefined,
    onToggleMine: () => undefined,
    onClose: () => undefined,
    ...overrides
  }
}

describe('MyStudyDialog（批4 P9/D5）', () => {
  it('关闭时整体不渲染——遮罩与滚动锁都不该留在 DOM 里', () => {
    const host = mount(<MyStudyDialog {...baseProps({ open: false })} />)
    expect(host.querySelector('[data-testid="my-study-dialog"]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('打开时复用面板本体：标题行 + 分组 + 右上关闭键，滚动锁生效', () => {
    const host = mount(<MyStudyDialog {...baseProps()} />)
    const dialog = host.querySelector('[data-testid="my-study-dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('我的学习')
    expect(dialog?.querySelector('.study-panel')).not.toBeNull()
    expect(host.textContent).toContain('已提取')
    const closeKey = host.querySelector('button[aria-label="关闭我的学习"]')
    expect(closeKey).not.toBeNull()
    // 滚动锁（与 CourseBrowser/CourseMapDialog 同一条缝）
    expect(document.body.style.overflow).toBe('hidden')
    expect(host.querySelector('.fullscreen-overlay')).not.toBeNull()
  })

  it('关闭键 / Esc / 点遮罩三条出口都关层', () => {
    const onClose = vi.fn()
    const host = mount(<MyStudyDialog {...baseProps({ onClose })} />)
    click(host.querySelector('button[aria-label="关闭我的学习"]'))
    expect(onClose).toHaveBeenCalledOnce()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(2)

    // 点遮罩本身关；点卡片内部不关。
    const overlay = host.querySelector('.fullscreen-overlay')!
    act(() => {
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(3)
    click(host.querySelector('.my-study-card'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('选课时先选中再关闭（弹层挡着笔记页，「选了没反应」是最坏的形态）', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const host = mount(<MyStudyDialog {...baseProps({ onSelect, onClose })} />)
    const lessonRow = host.querySelector('.lesson-row')
    expect(lessonRow).not.toBeNull()
    click(lessonRow)
    expect(onSelect).toHaveBeenCalledWith('l1')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('其余 props 透传：星标/导图/课时目录都走同一批 handler', () => {
    const onToggleMine = vi.fn()
    const onCourseMap = vi.fn()
    const onHarvestLessons = vi.fn()
    const noCatalog: CourseTreeInfo = { id: 'c2', name: '没有目录的课', isMine: true, lessons: [] }
    const host = mount(
      <MyStudyDialog
        {...baseProps({ mine: [noCatalog], expanded: new Set(['c1', 'c2']), onToggleMine, onCourseMap, onHarvestLessons })}
      />
    )
    click(host.querySelector('.pin-btn'))
    expect(onToggleMine).toHaveBeenCalledWith('c1', true)
    click(host.querySelector('button[aria-label^="查看课程导图"]'))
    expect(onCourseMap).toHaveBeenCalledWith('c1')
    const harvest = [...host.querySelectorAll('button')].find((b) => b.textContent === '抓取课时目录')
    expect(harvest).not.toBeUndefined()
    click(harvest ?? null)
    expect(onHarvestLessons).toHaveBeenCalledWith('c2')
  })
})
