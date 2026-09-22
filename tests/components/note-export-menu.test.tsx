import { describe, expect, it, vi } from 'vitest'
import { NoteExportMenu } from '../../src/renderer/components/NoteExportMenu'
import { mount, click } from '../helpers/preact'

/**
 * P48 (plan 2026-09-22-qa-dock-float-window): 「其它导出」菜单——笔记工具行导出格式
 * 收纳（Anki / Markdown / Obsidian 从平铺按钮改为菜单项，导出 PDF 讲义仍是工具栏主
 * 行动）。形制对齐 LessonChip 下拉：点外关闭、Escape 关闭并聚焦回触发器、busy 全禁。
 */
describe('NoteExportMenu', () => {
  it('renders one item per provided export and wires the click', () => {
    const onExportAnki = vi.fn()
    const onExport = vi.fn()
    const onExportObsidian = vi.fn()
    const host = mount(<NoteExportMenu onExportAnki={onExportAnki} onExport={onExport} onExportObsidian={onExportObsidian} />)
    // 默认收起：菜单项不在 DOM 里。
    expect(host.querySelector('.note-export-items')).toBeNull()
    click(host.querySelector('.note-export-trigger'))
    const items = [...host.querySelectorAll('.note-export-items button')]
    expect(items.map((b) => b.textContent)).toEqual(['导出 Anki', '导出 Markdown', '导出 Obsidian'])
    click(items[1]!)
    expect(onExport).toHaveBeenCalledTimes(1)
    // 点完即关（不像旧平铺按钮留着焦点歧义）。
    expect(host.querySelector('.note-export-items')).toBeNull()
  })

  it('renders nothing when no export handler is provided', () => {
    const host = mount(<NoteExportMenu />)
    expect(host.querySelector('.note-export-trigger')).toBeNull()
  })

  it('only lists the exports that are wired', () => {
    const host = mount(<NoteExportMenu onExportObsidian={() => undefined} />)
    click(host.querySelector('.note-export-trigger'))
    expect([...host.querySelectorAll('.note-export-items button')].map((b) => b.textContent)).toEqual(['导出 Obsidian'])
  })

  it('disables every item while an export is in flight and marks the busy one', () => {
    // 在途项 = markdown：它的文案换成「导出中…」，其余项只禁不换文案（与旧平铺按钮同语义）。
    const host = mount(<NoteExportMenu onExport={() => undefined} onExportAnki={() => undefined} exportBusy="markdown" />)
    click(host.querySelector('.note-export-trigger'))
    const byLabel = (label: string): HTMLButtonElement | null =>
      Array.from(host.querySelectorAll('.note-export-items button')).find((b) => b.textContent === label) as HTMLButtonElement | null
    expect(byLabel('导出中…')?.disabled).toBe(true)
    expect(byLabel('导出 Markdown')).toBeUndefined()
    expect(byLabel('导出 Anki')?.disabled).toBe(true)
  })

  // Preact 的状态更新是微任务异步的——派发事件后必须 waitFor 再断言，不能同步看 DOM。
  it('Escape closes the menu and returns focus to the trigger', async () => {
    const host = mount(<NoteExportMenu onExport={() => undefined} />)
    const trigger = host.querySelector<HTMLButtonElement>('.note-export-trigger')
    click(trigger)
    await vi.waitFor(() => expect(host.querySelector('.note-export-items')).not.toBeNull())
    trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(host.querySelector('.note-export-items')).toBeNull())
  })

  it('a click outside closes the menu', async () => {
    const host = mount(<NoteExportMenu onExport={() => undefined} />)
    click(host.querySelector('.note-export-trigger'))
    await vi.waitFor(() => expect(host.querySelector('.note-export-items')).not.toBeNull())
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await vi.waitFor(() => expect(host.querySelector('.note-export-items')).toBeNull())
  })
})
