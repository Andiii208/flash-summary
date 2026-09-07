import { describe, expect, it } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach } from 'vitest'
import { CourseMapDialog, type CourseMapInfo } from '../../src/renderer/components/CourseMapDialog'
import type { TreeNode } from '../../src/shared/notes/schema'

const TREE: TreeNode = {
  title: '数据结构',
  children: [
    { title: '第1节课 线性表', children: [{ title: '顺序表', children: [] }] },
    { title: '第2节课 树', children: [] }
  ]
}

const INFO: CourseMapInfo = { courseName: '数据结构', tree: TREE, lessons: 2, skipped: 1 }

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CourseMapDialog (M4.1 课程总导图, 2026-09-05)', () => {
  it('renders the course map with full MindMap interactions and a lesson count', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(<CourseMapDialog info={INFO} onClose={() => undefined} />, host)
    expect(host.querySelector('[data-testid="course-map-dialog"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="mindmap"]')).not.toBeNull()
    expect(host.textContent).toContain('2 个课时')
    expect(host.textContent).toContain('1 条损坏笔记已跳过')
    // The merged tree renders as map nodes (root + 2 lessons + 1 branch).
    expect(host.querySelectorAll('.mindmap-node')).toHaveLength(4)
    expect(host.querySelector('.mindmap-toolbar')).not.toBeNull()
  })

  it('the close button and overlay click both invoke onClose', () => {
    let closed = 0
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(<CourseMapDialog info={INFO} onClose={() => {
      closed += 1
    }} />, host)
    const close = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '关闭')!
    close.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(closed).toBe(1)
    const overlay = host.querySelector('.course-map-overlay')!
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: false }))
    expect(closed).toBe(2)
    // A click on the card itself must NOT close.
    host.querySelector('.course-map-card')!.dispatchEvent(new MouseEvent('click', { bubbles: false }))
    expect(closed).toBe(2)
  })

  it('批3: Escape closes the dialog (same convention as the other modals)', () => {
    let closed = 0
    const host = document.createElement('div')
    document.body.appendChild(host)
    act(() => {
      render(<CourseMapDialog info={INFO} onClose={() => {
        closed += 1
      }} />, host)
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(closed).toBe(1)
  })

  it('批3: a course with no usable notes shows an explanatory empty state, not a bare canvas', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(<CourseMapDialog info={{ courseName: '空课程', tree: { title: '空课程', children: [] }, lessons: 0, skipped: 0 }} onClose={() => undefined} />, host)
    expect(host.querySelector('[data-testid="course-map-empty"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="mindmap"]')).toBeNull()
    expect(host.textContent).toContain('还没有可用的笔记导图')
  })
})
