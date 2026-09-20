import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act } from 'preact/test-utils'
import { App } from '../../src/renderer/App'
import { mount, click } from '../helpers/preact'
import { fakeState, makeBridge, ok, page } from '../helpers/fake-app-bridge'
import type { Note } from '../../src/shared/notes/schema'
import {
  COPYRIGHT_NOTICE_CHECK_LABEL,
  COPYRIGHT_NOTICE_CONFIRM_LABEL,
  COPYRIGHT_NOTICE_MESSAGE,
  COPYRIGHT_NOTICE_TITLE
} from '../../src/shared/copyright-notice'

/**
 * 声明批4（plan 2026-09-11, D3=B/D6=A）: 导出前的版权提醒。
 *
 * 兑现 spec §9 与 README 早就写下、一直没实现的那句承诺。这里测三件事：
 *  ① 七个出口**每一个**都先过提醒（少一个就是漏了一处承诺）；
 *  ② 提醒只提示、不阻塞——确认后导出照常发生，取消则这次不导；
 *  ③ 「不再提示」勾了才生效（写库），没勾下次还会提醒。
 */

const NOTE: Note = {
  chapters: [],
  quotes: [],
  overview: '本讲介绍复杂度分析。',
  knowledgeTree: { title: '复杂度', children: [{ title: 'O(n)', children: [] }] },
  timeline: [{ at: 65, title: '引入', detail: '开始讲解', refs: [], evidence: [] }],
  concepts: [{ term: '大O', definition: '渐进上界', refs: [] }],
  formulasAndSteps: [],
  methodology: '先定义后举例。',
  examCues: ['必考：复杂度计算'],
  questionsAndGaps: ['如何分析递归复杂度？'],
  quiz: [],
  conceptLinks: [],
  transcriptRefs: [],
  evidence: []
}

async function waitFor(selector: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (document.querySelector(selector) == null) throw new Error(`waiting for ${selector}`)
    },
    { timeout: 3000, interval: 25 }
  )
}

/** The opt-out write → refreshSettings → re-render chain runs over a couple of
 *  macrotasks; clicking the next export too early still sees the old settings
 *  and pops the notice again. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60))
}

function buttonByText(selector: string, label: string): HTMLElement | null {
  const found = Array.from(document.querySelectorAll(selector)).find((node) => node.textContent === label)
  return found instanceof HTMLElement ? found : null
}

const NOTICE_TITLE = () => document.body.textContent?.includes(COPYRIGHT_NOTICE_TITLE) === true

/** The reminder is a shared Dialog: cancel first, confirm second. */
function confirmNotice(): void {
  click(buttonByText('.dialog-actions button', COPYRIGHT_NOTICE_CONFIRM_LABEL))
}

const clipboardWrite = vi.fn(async () => undefined)

describe('导出前的版权提醒', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.sessionStorage.clear()
    clipboardWrite.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWrite }, configurable: true })
  })

  /** Mount the app with the first lesson selected and a note on screen. */
  async function openNote(): Promise<ReturnType<typeof makeBridge>> {
    const bridge = makeBridge()
    // A processed lesson (so the shell lands on the笔记 tab) and a real note
    // (so the export toolbar exists at all).
    fakeState.courses = [{ id: 'c1', name: '数据结构', lessons: [{ id: 'l1', title: '第1讲', hasNote: true }] }]
    ;(bridge.notes as unknown as { latest: unknown }).latest = vi.fn(async () => ok(NOTE))
    // The note library must be non-empty at MOUNT: NoteViewer only renders it
    // in the «no note on screen» branch, and the index is not refetched later.
    ;(bridge.notes as unknown as { list: unknown }).list = vi.fn(async () =>
      ok(page([{ lessonId: 'l1', version: 1, createdAt: '2026-09-11T00:00:00Z', courseId: 'c1', courseName: '数据结构', teacher: '张老师', lessonTitle: '第1讲' }]))
    )
    mount(<App bridge={bridge} />)

    await waitFor('.app-shell')
    click(document.querySelector('[data-testid="all-courses-toggle"]'))
    await waitFor('.course-head')
    click(document.querySelector('.course-head'))
    await waitFor('.lesson-row')
    click(document.querySelector('.lesson-row'))
    click(buttonByText('.tabs button', '笔记'))
    await waitFor('.note-toolbar')
    return bridge
  }

  it('未经提醒不导出，且提醒里写的是版权事实而不是法条', async () => {
    const bridge = await openNote()
    click(buttonByText('.note-toolbar button', '导出 Markdown'))
    await waitFor('.dialog-actions')
    expect(bridge.notes.exportMarkdown).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(COPYRIGHT_NOTICE_MESSAGE)
  })

  it('七个出口逐一过提醒；确认后导出才真的发生', async () => {
    const bridge = await openNote()
    const toolbar = '.note-toolbar button'

    // ① Markdown ② Anki ③ Obsidian 单课时 ④ PDF —— 都在笔记工具栏上。
    const single = [
      { label: '导出 Markdown', call: () => bridge.notes.exportMarkdown },
      { label: '导出 Anki', call: () => bridge.notes.exportAnki },
      { label: '导出 Obsidian', call: () => bridge.notes.exportObsidian },
      { label: '导出 PDF 讲义', call: () => bridge.notes.exportPdfDialog }
    ]
    for (const { label, call } of single) {
      const spy = call() as ReturnType<typeof vi.fn>
      click(buttonByText(toolbar, label))
      await waitFor('.dialog-actions')
      expect(spy, `${label} 未经提醒就导出了`).toHaveBeenCalledTimes(0)
      confirmNotice()
      await vi.waitFor(() => expect(spy, `${label} 确认后没导出`).toHaveBeenCalledTimes(1))
      // 健康巡查批5: while an export is in flight every export button is
      // disabled (native save dialogs must not stack) — wait for it to clear
      // before driving the next exit.
      await settle()
    }

    // ⑤ 复制到剪贴板——同样是最容易被粘出去的一条路。
    click(buttonByText(toolbar, '复制 Markdown'))
    await waitFor('.dialog-actions')
    expect(clipboardWrite).toHaveBeenCalledTimes(0)
    confirmNotice()
    await vi.waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1))

    // ⑥ 导图 SVG —— 按钮在思维导图视图的工具栏里。
    click(buttonByText('.note-tabs button', '思维导图'))
    await waitFor('.mindmap-toolbar')
    click(buttonByText('.mindmap-toolbar button', '导出 SVG'))
    await waitFor('.dialog-actions')
    expect(bridge.notes.exportSvg).not.toHaveBeenCalled()
    confirmNotice()
    await vi.waitFor(() => expect(bridge.notes.exportSvg).toHaveBeenCalledTimes(1))
    await settle()

    // ⑦ 整课 Obsidian —— 入口在笔记库的课程组上。笔记库只在「未显示笔记」时出现，
    //    所以先回首页（品牌点击）再点课程组上的「导出 Obsidian」。
    click(document.querySelector('.brand'))
    click(buttonByText('.tabs button', '笔记'))
    await waitFor('[data-testid="note-library"]')
    click(buttonByText('.note-library-group-head button', '导出 Obsidian'))
    await waitFor('.dialog-actions')
    expect(bridge.notes.exportCourseObsidian).not.toHaveBeenCalled()
    confirmNotice()
    await vi.waitFor(() => expect(bridge.notes.exportCourseObsidian).toHaveBeenCalledTimes(1))
  })

  it('取消就是这次不导——不留任何副作用', async () => {
    const bridge = await openNote()
    click(buttonByText('.note-toolbar button', '导出 Markdown'))
    await waitFor('.dialog-actions')
    click(buttonByText('.dialog-actions button', '取消'))

    await vi.waitFor(() => expect(NOTICE_TITLE()).toBe(false))
    expect(bridge.notes.exportMarkdown).not.toHaveBeenCalled()
    // 取消不等于「不再提示」：库里的免除标记不能被写上。
    expect(bridge.settings.optOutCopyrightNotice).not.toHaveBeenCalled()
  })

  it('勾上「不再提示」才写库，之后的导出直接放行', async () => {
    const bridge = await openNote()
    click(buttonByText('.note-toolbar button', '导出 Markdown'))
    await waitFor('.dialog-actions')

    const box = document.querySelector('.dialog-check input') as HTMLInputElement | null
    // act() 是必须的：preact 在微任务里重渲染，不刷新的话确认键的闭包里
    // 还是旧的（未勾选）状态——这正是 smoke 里踩过的同一个坑。
    act(() => {
      box!.checked = true
      box!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    confirmNotice()

    await vi.waitFor(() => expect(bridge.settings.optOutCopyrightNotice).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(bridge.notes.exportMarkdown).toHaveBeenCalledTimes(1))
    expect(fakeState.copyrightNoticeOptOut).toBe(true)

    // 第二次导出：不再打扰（先等 settings 重新读回来）。
    await settle()
    click(buttonByText('.note-toolbar button', '导出 Anki'))
    await vi.waitFor(() => expect(bridge.notes.exportAnki).toHaveBeenCalledTimes(1))
    expect(NOTICE_TITLE()).toBe(false)
  })

  it('不勾就只是这次放过——下次导出还会提醒', async () => {
    const bridge = await openNote()
    click(buttonByText('.note-toolbar button', '导出 Markdown'))
    await waitFor('.dialog-actions')
    confirmNotice()
    await vi.waitFor(() => expect(bridge.notes.exportMarkdown).toHaveBeenCalledTimes(1))
    expect(bridge.settings.optOutCopyrightNotice).not.toHaveBeenCalled()
    await settle()

    click(buttonByText('.note-toolbar button', '导出 Anki'))
    await waitFor('.dialog-actions')
    expect(bridge.notes.exportAnki).not.toHaveBeenCalled()
    confirmNotice()
    await vi.waitFor(() => expect(bridge.notes.exportAnki).toHaveBeenCalledTimes(1))
  })

  it('提醒文案里没有法律术语（D7 裁决同样约束这一层）', () => {
    for (const word of ['跨境', '出境', '不可抗力']) {
      expect(COPYRIGHT_NOTICE_MESSAGE).not.toContain(word)
    }
    expect(COPYRIGHT_NOTICE_CHECK_LABEL).toBe('不再提示')
  })
})
