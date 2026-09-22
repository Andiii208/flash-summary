import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount } from '../helpers/preact'
import { useQaDockAtHero } from '../../src/renderer/hooks/use-qa-dock-at-hero'
import type { JSX } from 'preact'

/**
 * P50-2 (plan 2026-09-22-qa-dock-float-window): 「跟正文一起出现」——笔记停在题头
 * hero 带（工具行 + 封面 + 课程名 + 章节概括 chips）时追问卡片自动收成小球，滚进正文
 * 再展开。
 *
 * 判据是滚动位置（scrollTop < 题头带内容坐标底缘 − 80），不实时量矩形——所以测试只
 * 需要在给定 scrollTop 时把题头矩形桩打成「已滚动」的样子。happy-dom 没有布局，矩形
 * 与 scrollTop 都用手工桩。
 */

function Harness({ active }: { active: boolean }): JSX.Element {
  const atHero = useQaDockAtHero(active, 'k')
  return <span data-testid="state">{atHero ? 'hero' : 'body'}</span>
}

const CONTENT_TOP = 44
const MASTHEAD_HEIGHT = 485

/** .content 的视口矩形（内容区视口顶 = 44）。 */
function stubScrollerRect(scroller: HTMLElement): void {
  scroller.getBoundingClientRect = (): DOMRect =>
    ({ top: CONTENT_TOP, bottom: 738, left: 0, right: 0, width: 0, height: 694, x: 0, y: CONTENT_TOP, toJSON: () => ({}) }) as DOMRect
}

/** 题头矩形按 scrollTop 换算成「已滚动」的样子。 */
function stubMastheadRect(masthead: HTMLElement, scrollTop: number): void {
  const top = CONTENT_TOP - scrollTop
  masthead.getBoundingClientRect = (): DOMRect =>
    ({ top, bottom: top + MASTHEAD_HEIGHT, left: 0, right: 0, width: 0, height: MASTHEAD_HEIGHT, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
}

/** 滚到指定位置并派发 scroll。 */
function scrollTo(scroller: HTMLElement, next: number): void {
  scroller.scrollTop = next
  const masthead = scroller.querySelector<HTMLElement>('.note-masthead')
  if (masthead != null) stubMastheadRect(masthead, next)
  scroller.dispatchEvent(new Event('scroll'))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useQaDockAtHero (P50-2)', () => {
  it('停在题头带（scrollTop 0）⇒ hero，卡片应收成小球', async () => {
    const scroller = document.createElement('div')
    scroller.className = 'content'
    const masthead = document.createElement('div')
    masthead.className = 'note-masthead'
    scroller.appendChild(masthead)
    document.body.appendChild(scroller)
    stubScrollerRect(scroller)
    stubMastheadRect(masthead, 0)
    const host = mount(<Harness active />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('hero'))
  })

  it('滚过题头带底缘 − 80 ⇒ 正文展开；滚回首屏 ⇒ 又收回小球', async () => {
    const scroller = document.createElement('div')
    scroller.className = 'content'
    const masthead = document.createElement('div')
    masthead.className = 'note-masthead'
    scroller.appendChild(masthead)
    document.body.appendChild(scroller)
    stubScrollerRect(scroller)
    stubMastheadRect(masthead, 0)
    const host = mount(<Harness active />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('hero'))
    // 题头带内容坐标底缘 = 44 + 485 = 529；80 缓冲 ⇒ 阈值 449。滚到 500 越过阈值。
    scrollTo(scroller, 500)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('body'))
    scrollTo(scroller, 0)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('hero'))
  })

  // 没有题头（空库/库列表态）⇒ 不算 hero：卡片照常显示（空态卡片/近期追问在那儿有用）。
  it('没有题头（空库/库列表态）⇒ 直接给正文态，卡片不收起', async () => {
    const scroller = document.createElement('div')
    scroller.className = 'content'
    document.body.appendChild(scroller)
    stubScrollerRect(scroller)
    const host = mount(<Harness active />)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('body'))
    scrollTo(scroller, 300)
    await vi.waitFor(() => expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('body'))
  })

  it('active=false（非笔记页）时不监听——滚动也不切态', async () => {
    const scroller = document.createElement('div')
    scroller.className = 'content'
    const masthead = document.createElement('div')
    masthead.className = 'note-masthead'
    scroller.appendChild(masthead)
    document.body.appendChild(scroller)
    stubScrollerRect(scroller)
    stubMastheadRect(masthead, 0)
    const host = mount(<Harness active={false} />)
    await new Promise((r) => setTimeout(r, 30))
    scrollTo(scroller, 900)
    await new Promise((r) => setTimeout(r, 30))
    expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('hero')
  })
})
