import { describe, expect, it, vi } from 'vitest'
import { CourseBrowser } from '../../src/renderer/components/CourseBrowser'
import type { CourseTreeInfo } from '../../src/shared/bridge'
import { mount, click, input } from '../helpers/preact'

/** 批4 (plan 2026-09-13): the fullscreen course browser — count line, search,
 *  chunked reveal, empty state, and the modal exits. 批5 covers the filters
 *  and the per-card actions. */

function courseOf(id: string, name: string, teacher = '汪海'): CourseTreeInfo {
  return {
    id,
    name,
    teacher,
    term: '2026-2027',
    classroom: '中山-312',
    courTimes: '周一 第3-4节',
    subjCode: 'B11L0011',
    lessons: [{ id: `${id}-l1`, title: '第5节课', hasNote: true }]
  }
}

const TREE: CourseTreeInfo[] = [
  courseOf('c1', '电子电路及系统I课程设计', '王辰星'),
  { ...courseOf('c2', '网络信息编程（全英文）'), classroom: '东南-207' },
  { ...courseOf('c3', '（中英字幕完结）斯坦福CS224N', '吴恩达'), source: 'bilibili' as const }
]

describe('CourseBrowser', () => {
  it('renders nothing when closed', () => {
    const host = mount(<CourseBrowser open={false} tree={TREE} onClose={() => undefined} />)
    expect(host.querySelector('[data-testid="course-browser"]')).toBeNull()
  })

  it('lists the catalog with the count line and the disambiguation sub line', () => {
    const host = mount(<CourseBrowser open tree={TREE} onClose={() => undefined} />)
    expect(host.querySelectorAll('[data-testid="course-browser-grid"] .course-card')).toHaveLength(3)
    const meta = host.querySelector('[data-testid="course-browser-meta"]')
    expect(meta?.textContent).toContain('本地已收录 3 门')
    expect(meta?.textContent).toContain('搜索只查本地已收录的课')
    const first = host.querySelector('.course-card')
    expect(first?.textContent).toContain('电子电路及系统I课程设计')
    expect(first?.querySelector('.course-card-sub')?.textContent).toBe('王辰星 · 周一 第3-4节 · 中山-312 · 2026-2027')
    // B站 badge carried over from the sidebar row language.
    const bili = [...host.querySelectorAll('.course-card')].find((card) => card.textContent.includes('斯坦福'))
    expect(bili?.querySelector('.badge.bili')).not.toBeNull()
  })

  it('filters by teacher (the field that tells same-name courses apart) with a matched count', () => {
    const host = mount(<CourseBrowser open tree={TREE} onClose={() => undefined} />)
    input(host.querySelector('.course-browser-search'), '王辰星')
    const cards = host.querySelectorAll('[data-testid="course-browser-grid"] .course-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]?.textContent).toContain('电子电路及系统I课程设计')
    expect(host.querySelector('[data-testid="course-browser-meta"]')?.textContent).toContain('匹配 1 门 / 本地已收录 3 门')
  })

  it('filters by classroom (批4 addition to the search haystack)', () => {
    const host = mount(<CourseBrowser open tree={TREE} onClose={() => undefined} />)
    input(host.querySelector('.course-browser-search'), '东南-207')
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    expect(host.querySelector('.course-card')?.textContent).toContain('网络信息编程')
  })

  it('shows the empty hint when nothing matches', () => {
    const host = mount(<CourseBrowser open tree={TREE} onClose={() => undefined} />)
    input(host.querySelector('.course-browser-search'), '线性代数')
    expect(host.querySelector('[data-testid="course-browser-grid"]')).toBeNull()
    expect(host.querySelector('.course-browser-empty')?.textContent).toContain('没有匹配的课程')
  })

  it('reveals the catalog in chunks of 120 with an explicit «显示更多»', () => {
    const big = Array.from({ length: 250 }, (_, i) => courseOf(`c${i}`, `课程${i}`))
    const host = mount(<CourseBrowser open tree={big} onClose={() => undefined} />)
    expect(host.querySelectorAll('.course-card')).toHaveLength(120)
    const more = host.querySelector('.course-browser-more')
    expect(more?.textContent).toContain('还有 130 门')
    click(more)
    expect(host.querySelectorAll('.course-card')).toHaveLength(240)
    expect(host.querySelector('.course-browser-more')?.textContent).toContain('还有 10 门')
    click(host.querySelector('.course-browser-more'))
    expect(host.querySelectorAll('.course-card')).toHaveLength(250)
    expect(host.querySelector('.course-browser-more')).toBeNull()
  })

  it('typing resets the chunk so a new search starts from the top', () => {
    const big = Array.from({ length: 300 }, (_, i) => courseOf(`c${i}`, `课程${i}`))
    const host = mount(<CourseBrowser open tree={big} onClose={() => undefined} />)
    click(host.querySelector('.course-browser-more'))
    expect(host.querySelectorAll('.course-card')).toHaveLength(240)
    input(host.querySelector('.course-browser-search'), '课程')
    expect(host.querySelectorAll('.course-card')).toHaveLength(120)
    expect(host.querySelector('.course-browser-more')?.textContent).toContain('还有 180 门')
  })

  it('closes via the button, Escape, and a backdrop click', () => {
    const onClose = vi.fn()
    const host = mount(<CourseBrowser open tree={TREE} onClose={onClose} />)
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '关闭') ?? null)
    expect(onClose).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    click(host.querySelector('.course-browser-overlay'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('lands focus in the search box when opened', () => {
    const host = mount(<CourseBrowser open tree={TREE} onClose={() => undefined} />)
    const input = host.querySelector('.course-browser-search') as HTMLInputElement
    expect(document.activeElement).toBe(input)
  })
})
