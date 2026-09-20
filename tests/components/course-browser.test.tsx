import { describe, expect, it, vi } from 'vitest'
import { act } from 'preact/test-utils'
import { CourseBrowser } from '../../src/renderer/components/CourseBrowser'
import type { CourseTreeInfo } from '../../src/shared/bridge'
import { mount, click, input } from '../helpers/preact'

/** 批4/批5 (plan 2026-09-13): the fullscreen course browser — search, count
 *  line, chunked reveal, empty state, modal exits, and the 批5 filter/sort/
 *  card-action layer. */

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
  { ...courseOf('c1', '电子电路及系统I课程设计', '王辰星'), hasExtracted: true, noteCount: 2, lastTaskAt: '2026-09-08T10:00:00Z' },
  { ...courseOf('c2', '网络信息编程（全英文）'), classroom: '东南-207', lessons: [], noteCount: 0 },
  { ...courseOf('c3', '（中英字幕完结）斯坦福CS224N', '吴恩达'), source: 'bilibili' as const, isMine: true, term: '2025-2026' }
]

/** Preact listens for the native change event on <select> — set the value and
 *  fire it inside act so the controlled re-render flushes. */
function selectValue(select: HTMLSelectElement | null, value: string): void {
  act(() => {
    if (select == null) return
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function makeProps() {
  return {
    open: true as const,
    tree: TREE,
    onSelectLesson: vi.fn(),
    onToggleMine: vi.fn(),
    onHarvestLessons: vi.fn(),
    onRemoveCourse: vi.fn(),
    onCourseMap: vi.fn(),
    onClose: vi.fn()
  }
}

describe('CourseBrowser', () => {
  it('renders nothing when closed', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} open={false} />)
    expect(host.querySelector('[data-testid="course-browser"]')).toBeNull()
  })

  it('lists the catalog with the count line and the disambiguation sub line', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    expect(host.querySelectorAll('[data-testid="course-browser-grid"] .course-card')).toHaveLength(3)
    const meta = host.querySelector('[data-testid="course-browser-meta"]')
    expect(meta?.textContent).toContain('本地已收录 3 门')
    expect(meta?.textContent).toContain('搜索只查本地已收录的课')
    // Default sort pins «已收藏» first (orderMyCoursesFirst parity), so find
    // by content instead of position.
    const circuit = [...host.querySelectorAll('.course-card')].find((card) => card.textContent.includes('电子电路及系统I课程设计'))
    expect(circuit?.querySelector('.course-card-sub')?.textContent).toBe('王辰星 · 周一 第3-4节 · 中山-312 · 2026-2027')
    // B站 badge carried over from the sidebar row language.
    const bili = [...host.querySelectorAll('.course-card')].find((card) => card.textContent.includes('斯坦福'))
    expect(bili?.querySelector('.badge.bili')).not.toBeNull()
  })

  it('批4 a11y: 搜索框有 aria-label（与侧栏/笔记库/MindMap 搜索框同款）', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const box = host.querySelector<HTMLInputElement>('.course-browser-search')
    expect(box).not.toBeNull()
    expect(box?.getAttribute('aria-label')).toBe('搜索课程')
  })

  it('filters by teacher (the field that tells same-name courses apart) with a matched count', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    input(host.querySelector('.course-browser-search'), '王辰星')
    const cards = host.querySelectorAll('[data-testid="course-browser-grid"] .course-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]?.textContent).toContain('电子电路及系统I课程设计')
    expect(host.querySelector('[data-testid="course-browser-meta"]')?.textContent).toContain('匹配 1 门 / 本地已收录 3 门')
  })

  it('filters by classroom (批4 addition to the search haystack)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    input(host.querySelector('.course-browser-search'), '东南-207')
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    expect(host.querySelector('.course-card')?.textContent).toContain('网络信息编程')
  })

  it('shows the empty hint when nothing matches', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    input(host.querySelector('.course-browser-search'), '线性代数')
    expect(host.querySelector('[data-testid="course-browser-grid"]')).toBeNull()
    expect(host.querySelector('.course-browser-empty')?.textContent).toContain('没有匹配的课程')
  })

  it('filters by term and by source via the selects (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const selects = [...host.querySelectorAll<HTMLSelectElement>('.course-browser-select')]
    selectValue(selects[0], '2025-2026')
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    expect(host.querySelector('.course-card')?.textContent).toContain('斯坦福')
    selectValue(selects[1], 'bilibili')
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    // Source narrows the term selection further: B站 AND 2026-2027 = none.
    selectValue(selects[0], '2026-2027')
    expect(host.querySelector('.course-browser-empty')).not.toBeNull()
  })

  it('filters by status chips with union semantics (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const chip = (label: string): HTMLButtonElement =>
      [...host.querySelectorAll('.course-browser-filters .chip')].find((b) => b.textContent === label) as HTMLButtonElement
    click(chip('已提取') ?? null)
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    expect(host.querySelector('.course-card')?.textContent).toContain('电子电路')
    // Union: 已提取 OR 已收藏 → two cards.
    click(chip('已收藏') ?? null)
    expect(host.querySelectorAll('.course-card')).toHaveLength(2)
    // 从未处理 alone → the never-touched course.
    click(chip('已提取') ?? null)
    click(chip('已收藏') ?? null)
    click(chip('从未处理') ?? null)
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    expect(host.querySelector('.course-card')?.textContent).toContain('网络信息编程')
  })

  it('clicking a teacher name filters by that teacher; the chip clears it (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const teacherBtn = [...host.querySelectorAll('.course-card-teacher')].find((b) => b.textContent === '王辰星')
    click(teacherBtn ?? null)
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    const chip = [...host.querySelectorAll('.course-browser-filters .chip')].find((b) => b.textContent?.includes('教师：王辰星'))
    expect(chip).not.toBeUndefined()
    click(chip ?? null)
    expect(host.querySelectorAll('.course-card')).toHaveLength(3)
  })

  it('sorts by name (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const selects = [...host.querySelectorAll<HTMLSelectElement>('.course-browser-select')]
    selectValue(selects[3], 'name')
    const first = host.querySelector('.course-card')?.textContent ?? ''
    // zh-CN collation: «（中英…» opens with a fullwidth paren and sorts first.
    expect(first).toContain('斯坦福')
  })

  it('expands a card, picks a lesson, and the browser closes with the selection made (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const circuit = [...host.querySelectorAll('.course-card')].find((card) => card.textContent.includes('电子电路'))
    click(circuit?.querySelector('.course-card-main') ?? null)
    const lesson = circuit?.querySelector('.course-card-lesson')
    expect(lesson?.textContent).toContain('第5节课')
    click(lesson ?? null)
    expect(props.onSelectLesson).toHaveBeenCalledWith('c1-l1')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('highlights the currently selected lesson inside an expanded card (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} selectedLessonId="c1-l1" />)
    const circuit = [...host.querySelectorAll('.course-card')].find((card) => card.textContent.includes('电子电路'))
    click(circuit?.querySelector('.course-card-main') ?? null)
    expect(circuit?.querySelector('.course-card-lesson.selected')?.textContent).toContain('第5节课')
  })

  it('stars a course via the card pin (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const circuit = [...host.querySelectorAll('.course-card')].find((card) => card.textContent.includes('电子电路'))
    click(circuit?.querySelector('.pin-btn') ?? null)
    expect(props.onToggleMine).toHaveBeenCalledWith('c1', true)
  })

  it('offers 抓取课时目录 on a course without a catalog, delete on a never-processed one (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const emptyCard = [...host.querySelectorAll('.course-card')].find((card) => card.textContent.includes('网络信息编程'))
    click(emptyCard?.querySelector('.course-card-main') ?? null)
    const harvest = [...(emptyCard?.querySelectorAll('button') ?? [])].find((b) => b.textContent === '抓取课时目录')
    click(harvest ?? null)
    expect(props.onHarvestLessons).toHaveBeenCalledWith('c2')
    // C6 parity: only the never-processed card carries the delete button.
    click(emptyCard?.querySelector('.pin-btn[aria-label^="删除课程"]') ?? null)
    const confirm = [...host.querySelectorAll('.dialog-actions button')].find((b) => b.textContent === '删除')
    click(confirm ?? null)
    expect(props.onRemoveCourse).toHaveBeenCalledWith('c2')
  })

  it('reveals the catalog in chunks of 120 with an explicit «显示更多»', () => {
    const props = makeProps()
    const big = Array.from({ length: 250 }, (_, i) => courseOf(`c${i}`, `课程${i}`))
    const host = mount(<CourseBrowser {...props} tree={big} />)
    expect(host.querySelectorAll('.course-card')).toHaveLength(120)
    const more = host.querySelector('.course-browser-more')
    expect(more?.textContent).toContain('还有 130 门')
    click(more ?? null)
    expect(host.querySelectorAll('.course-card')).toHaveLength(240)
    expect(host.querySelector('.course-browser-more')?.textContent).toContain('还有 10 门')
    click(host.querySelector('.course-browser-more'))
    expect(host.querySelectorAll('.course-card')).toHaveLength(250)
    expect(host.querySelector('.course-browser-more')).toBeNull()
  })

  it('typing resets the chunk so a new search starts from the top', () => {
    const props = makeProps()
    const big = Array.from({ length: 300 }, (_, i) => courseOf(`c${i}`, `课程${i}`))
    const host = mount(<CourseBrowser {...props} tree={big} />)
    click(host.querySelector('.course-browser-more'))
    expect(host.querySelectorAll('.course-card')).toHaveLength(240)
    input(host.querySelector('.course-browser-search'), '课程')
    expect(host.querySelectorAll('.course-card')).toHaveLength(120)
    expect(host.querySelector('.course-browser-more')?.textContent).toContain('还有 180 门')
  })

  it('清除筛选 resets every filter and the sort (批5)', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    input(host.querySelector('.course-browser-search'), '王辰星')
    const selects = [...host.querySelectorAll<HTMLSelectElement>('.course-browser-select')]
    selectValue(selects[3], 'name')
    expect(host.querySelectorAll('.course-card')).toHaveLength(1)
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '清除筛选') ?? null)
    expect(host.querySelectorAll('.course-card')).toHaveLength(3)
    expect((host.querySelector('.course-browser-search') as HTMLInputElement).value).toBe('')
    expect(host.querySelector('[data-testid="course-browser-meta"]')?.textContent).toContain('本地已收录 3 门')
  })

  it('closes via the button, Escape, and a backdrop click', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    click([...host.querySelectorAll('button')].find((b) => b.textContent === '关闭') ?? null)
    expect(props.onClose).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
    click(host.querySelector('.course-browser-overlay'))
    expect(props.onClose).toHaveBeenCalledTimes(3)
  })

  // 批1 补口（验收项「Esc 只关一层」）：确认弹层是 z-index 60 那一档，恒在自绘
  // overlay（40）之上——它开着时一次 Esc 只关弹层，浏览器不能跟着一起消失。
  it('批1 (P13): 卡上确认弹层开着时 Esc 只关弹层，浏览器留在原处', async () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    // c2 是唯一「从未处理过」的课程（无课时、无笔记）——只有它带删除键。
    click(host.querySelector('button[aria-label="删除课程 网络信息编程（全英文）"]'))
    await new Promise((r) => setTimeout(r, 10))
    expect(host.querySelector('.dialog-backdrop')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await new Promise((r) => setTimeout(r, 10))
    expect(host.querySelector('.dialog-backdrop')).toBeNull()
    expect(host.querySelector('[data-testid="course-browser"]')).not.toBeNull()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(props.onRemoveCourse).not.toHaveBeenCalled()
    // 第二层再按一次才轮到浏览器自己关。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('lands focus in the search box when opened', () => {
    const props = makeProps()
    const host = mount(<CourseBrowser {...props} />)
    const inputEl = host.querySelector('.course-browser-search') as HTMLInputElement
    expect(document.activeElement).toBe(inputEl)
  })
})
