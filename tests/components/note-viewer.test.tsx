import { describe, expect, it, vi } from 'vitest'
import { NoteViewer } from '../../src/renderer/components/NoteViewer'
import { mount, click, input } from '../helpers/preact'
import type { Note } from '../../src/shared/notes/schema'
import type * as mdLiteModule from '../../src/shared/notes/md-lite'
import type * as viewsModule from '../../src/shared/notes/views'
import { parseInline } from '../../src/shared/notes/md-lite'
import { projectNoteBlocks } from '../../src/shared/notes/views'

// 批4: memo 有效性要用计数器说话——解析/投影换成间谍，其余导出保持真实现。
// 注意：parseMdLite 模块内部对 parseInline 的调用不经过导出绑定，
// 所以计数器量的正是 InlineText 每次渲染触发的解析。
vi.mock('../../src/shared/notes/md-lite', async (importOriginal) => {
  const actual = await importOriginal<typeof mdLiteModule>()
  return { ...actual, parseInline: vi.fn(actual.parseInline) }
})
vi.mock('../../src/shared/notes/views', async (importOriginal) => {
  const actual = await importOriginal<typeof viewsModule>()
  return { ...actual, projectNoteBlocks: vi.fn(actual.projectNoteBlocks) }
})

const NOTE: Note = {
  chapters: [],
  quotes: [],
  overview: '本讲介绍复杂度分析。',
  knowledgeTree: { title: '复杂度', children: [{ title: 'O(n)', children: [] }] },
  timeline: [
    { at: 65, title: '引入', detail: '开始讲解', refs: [], evidence: [] },
    { at: 300, title: '示例', detail: '举例说明', refs: [], evidence: [] }
  ],
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

const ATTACHMENT = {
  ref: 'kf:kf-3',
  kind: 'keyframe' as const,
  at: 300,
  dataUrl: 'data:image/jpeg;base64,Zm9v'
}

describe('NoteViewer', () => {
  it('shows the placeholder when there is no note', () => {
    const host = mount(<NoteViewer note={null} />)
    expect(host.textContent).toContain('尚无笔记')
  })

  it('hides the five-view toolbar when there is no note to switch (2026-09-05)', () => {
    const host = mount(<NoteViewer note={null} onExport={() => undefined} onRegenerate={() => undefined} />)
    expect(host.querySelector('.note-toolbar')).toBeNull()
    expect(host.querySelectorAll('.note-tabs button')).toHaveLength(0)
  })

  it('A5 (plan 2026-09-13): 导出 PDF 讲义 is the toolbar’s LAST action and pins right', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        onExportPdf={() => undefined}
        onRegenerate={() => undefined}
        onCopy={() => undefined}
        onExport={() => undefined}
        onExportAnki={() => undefined}
        onExportObsidian={() => undefined}
      />
    )
    const pdf = host.querySelector('.note-actions .note-pdf-btn')
    expect(pdf).not.toBeNull()
    const actionNodes = [...host.querySelectorAll('.note-actions > *')]
    expect(actionNodes[actionNodes.length - 1]).toBe(pdf)
  })

  it('renders the exam-paper masthead only with a note and lesson context (V4)', () => {
    const bare = mount(<NoteViewer note={NOTE} />)
    expect(bare.querySelector('.note-masthead')).toBeNull()
    const host = mount(<NoteViewer note={NOTE} lesson={{ courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }} />)
    const masthead = host.querySelector('.note-masthead')
    expect(masthead).not.toBeNull()
    expect(masthead?.querySelector('.note-title')?.textContent).toBe('算法导论')
    expect(masthead?.querySelector('.note-meta')?.textContent).toBe('汪海 · 第五讲')
  })

  it('renders the detailed view by default as timeline cards with stamps', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    expect(host.textContent).toContain('课程概览')
    expect(host.textContent).toContain('01:05')
    expect(host.textContent).toContain('引入')
    const cards = host.querySelectorAll('.timeline-card')
    expect(cards).toHaveLength(2)
    expect(host.querySelector('.timeline-stamp')?.textContent).toBe('01:05')
  })

  it('批3: the reading-view tree offers 全部展开/收起 (parity with the mind map)', () => {
    // tools() 取树视图工具行里的两个按钮（批6 起顺序固定为 收起 → 展开）。
    const deep: Note = {
      ...NOTE,
      knowledgeTree: { title: '根', children: [{ title: '分支A', children: [{ title: '子节A1', children: [{ title: '叶子A1a', children: [] }] }] }] }
    }
    const host = mount(<NoteViewer note={deep} />)
    // Default open depth is 2: 根/分支A/子节A1 visible, 叶子A1a folded away.
    expect(host.querySelector('.tree-view')).not.toBeNull()
    expect(host.textContent).not.toContain('叶子A1a')
    const tools = (): HTMLButtonElement[] => Array.from(host.querySelectorAll('.tree-view-tools button'))
    const tool = (label: string): HTMLButtonElement => tools().find((b) => b.textContent === label) as HTMLButtonElement
    // 批6 (T39): 顺序统一为「由少到多」——全部收起在前，全部展开在后。
    expect(tools().map((b) => b.textContent)).toEqual(['全部收起', '全部展开'])
    click(tool('全部展开'))
    expect(host.textContent).toContain('叶子A1a')
    click(tool('全部收起'))
    expect(host.textContent).not.toContain('叶子A1a')
    // The root row itself stays visible after a collapse-all.
    expect(host.textContent).toContain('根')
  })

  it('binds the nearest keyframe onto a timeline card without evidence refs', () => {
    const host = mount(<NoteViewer note={NOTE} attachmentManifest={[ATTACHMENT]} getAttachment={(ref) => (ref === ATTACHMENT.ref ? ATTACHMENT : null)} />)
    const card = host.querySelectorAll('.timeline-card')[1]!
    expect(card.querySelector('.timeline-thumb img')?.getAttribute('src')).toBe(ATTACHMENT.dataUrl)
    // 批6: badge copy speaks plainly and the button title explains the origin.
    expect(card.querySelector('.thumb-origin')?.textContent).toBe('临近画面')
    expect(card.querySelector('.timeline-thumb')?.getAttribute('title')).toContain('临近关键帧')
    // The 引入 card (65s) is out of tolerance from the 300s keyframe.
    expect(host.querySelectorAll('.timeline-card')[0]!.querySelector('.timeline-thumb')).toBeNull()
  })

  it('clicking the timestamp expands every transcript quote, then collapses', () => {
    const richNote: Note = {
      ...NOTE,
      timeline: [
        {
          at: 65,
          title: '引入',
          detail: '开始讲解',
          refs: [
            { at: 60, text: '第一条引文' },
            { at: 70, text: '第二条引文' },
            { at: 80, text: '第三条引文' }
          ],
          evidence: []
        }
      ]
    }
    const host = mount(<NoteViewer note={richNote} />)
    const card = host.querySelector('.timeline-card')!
    // Collapsed: the closest quote — at=65 ties 60 and 70 at Δ5, the earlier wins.
    expect(card.querySelectorAll('.timeline-quote')).toHaveLength(1)
    expect(card.textContent).toContain('第一条引文')
    const toggle = card.querySelector('.refs-toggle') as HTMLButtonElement
    expect(toggle.textContent).toContain('3 条引文')
    click(toggle)
    expect(card.querySelectorAll('.timeline-quote')).toHaveLength(3)
    expect(card.textContent).toContain('第二条引文')
    expect(card.textContent).toContain('第三条引文')
    // The mm:ss stamp is itself a button toggling the same state.
    click(card.querySelector('.timeline-stamp') as HTMLButtonElement)
    expect(card.querySelectorAll('.timeline-quote')).toHaveLength(1)
  })

  it('switches views when a tab is clicked', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    const tabs = host.querySelectorAll('.note-tabs button')
    expect(tabs[0]!.textContent).toBe('详细笔记')
    const keyPoints = Array.from(tabs).find((b) => b.textContent === '要点') ?? null
    click(keyPoints)
    expect(keyPoints?.classList.contains('active')).toBe(true)
    expect(host.textContent).toContain('必考：复杂度计算')
    expect(host.querySelectorAll('.callout-item').length).toBeGreaterThan(0)
  })

  it('renders all five view tabs including the mind map', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    const labels = Array.from(host.querySelectorAll('.note-tabs button')).map((b) => b.textContent)
    expect(labels).toEqual(['详细笔记', '标准总结', '要点', '方法论', '思维导图'])
    const mindmapTab = Array.from(host.querySelectorAll('.note-tabs button')).find((b) => b.textContent === '思维导图') ?? null
    click(mindmapTab)
    expect(host.querySelector('[data-testid="mindmap"]')).not.toBeNull()
    expect(host.querySelectorAll('.mindmap-node')).toHaveLength(2)
  })

  it('exposes the active view on note-body so the mind map can break out full width (批A)', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    expect(host.querySelector('.note-body')?.getAttribute('data-view')).toBe('detailed')
    const mindmapTab = Array.from(host.querySelectorAll('.note-tabs button')).find((b) => b.textContent === '思维导图') ?? null
    click(mindmapTab)
    expect(host.querySelector('.note-body')?.getAttribute('data-view')).toBe('mindmap')
  })

  it('renders markdown overview through md-lite (headings, bold, lists)', () => {
    const markdownNote: Note = {
      ...NOTE,
      overview: '总起一句。\n\n## 本讲主线\n\n- 复杂度定义\n- **大O** 记号'
    }
    const host = mount(<NoteViewer note={markdownNote} />)
    expect(host.querySelectorAll('.md-lite .md-h')).toHaveLength(1)
    expect(host.querySelectorAll('.md-lite .md-list li')).toHaveLength(2)
    expect(host.querySelector('.md-lite strong')?.textContent).toBe('大O')
  })

  it('shows the regenerate button only with a note and wires busy state', () => {
    const onRegenerate = vi.fn()
    const idle = mount(<NoteViewer note={NOTE} onRegenerate={onRegenerate} regenBusy={false} />)
    const button = Array.from(idle.querySelectorAll('button')).find((b) => b.textContent === '重新生成')!
    click(button)
    expect(onRegenerate).toHaveBeenCalledTimes(1)
    const busy = mount(<NoteViewer note={NOTE} onRegenerate={onRegenerate} regenBusy />)
    expect(Array.from(busy.querySelectorAll('button')).find((b) => b.textContent === '生成中…')).not.toBeNull()
  })

  it('shows the Anki export button only with a note and wires the click (roadmap 2.2)', () => {
    const onExportAnki = vi.fn()
    const host = mount(<NoteViewer note={NOTE} onExportAnki={onExportAnki} />)
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '导出 Anki')!
    click(button)
    expect(onExportAnki).toHaveBeenCalledTimes(1)
    const bare = mount(<NoteViewer note={null} onExportAnki={onExportAnki} />)
    expect(Array.from(bare.querySelectorAll('button')).find((b) => b.textContent === '导出 Anki')).toBeUndefined()
  })

  it('renders the evidence gallery section in the detailed view', () => {
    const host = mount(<NoteViewer note={NOTE} attachmentManifest={[ATTACHMENT]} getAttachment={(ref) => (ref === ATTACHMENT.ref ? ATTACHMENT : null)} />)
    expect(host.querySelector('[data-testid="evidence-gallery"]')).not.toBeNull()
    expect(host.querySelector('.evidence-fig img')?.getAttribute('src')).toBe(ATTACHMENT.dataUrl)
  })

  it('flips a quiz card from question to answer on click (roadmap 2.1)', () => {
    const quizNote: Note = {
      ...NOTE,
      quiz: [
        { question: '什么是大O？', answer: '渐进上界', source: 'concept', term: '大O' },
        { question: '递归复杂度怎么考？', answer: '主定理展开', source: 'examCue' }
      ]
    }
    const host = mount(<NoteViewer note={quizNote} />)
    const keyPoints = Array.from(host.querySelectorAll('.note-tabs button')).find((b) => b.textContent === '要点') ?? null
    click(keyPoints)
    expect(host.querySelector('[data-testid="quiz-cards"]')).not.toBeNull()
    const cards = host.querySelectorAll('.quiz-card')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.querySelector('.quiz-question')?.textContent).toBe('什么是大O？')
    expect(cards[0]!.querySelector('.quiz-answer')).toBeNull()
    expect(cards[0]!.querySelector('.quiz-tag')?.textContent).toBe('概念 · 大O')
    // Question side shows the hint; clicking flips to the answer.
    expect(cards[0]!.querySelector('.quiz-hint')?.textContent).toBe('点击翻面看答案')
    click(cards[0]!.querySelector('.quiz-flip') as HTMLButtonElement)
    expect(cards[0]!.querySelector('.quiz-answer')?.textContent).toBe('渐进上界')
    // 批6: the revealed side advertises that clicking again collapses it.
    expect(cards[0]!.querySelector('.quiz-collapse-hint')?.textContent).toBe('再点一次收起')
    // The other card stays question-side until clicked too.
    expect(cards[1]!.querySelector('.quiz-answer')).toBeNull()
    click(cards[1]!.querySelector('.quiz-flip') as HTMLButtonElement)
    expect(cards[1]!.querySelector('.quiz-answer')?.textContent).toBe('主定理展开')
    // Flipped cards hide the answer again on a second click.
    click(cards[0]!.querySelector('.quiz-flip') as HTMLButtonElement)
    expect(cards[0]!.querySelector('.quiz-answer')).toBeNull()
  })

  it('shows the citation hit badge when evidence refs resolve, hides with none cited', () => {
    const citedNote: Note = {
      ...NOTE,
      timeline: [
        { at: 10, title: 'a', detail: 'd', refs: [], evidence: [{ kind: 'keyframe', ref: 'kf:kf-3' }] },
        { at: 20, title: 'b', detail: 'd', refs: [], evidence: [{ kind: 'keyframe', ref: 'kf:missing.1' }] }
      ]
    }
    const host = mount(<NoteViewer note={citedNote} attachmentManifest={[ATTACHMENT]} getAttachment={(ref) => (ref === ATTACHMENT.ref ? ATTACHMENT : null)} />)
    expect(host.querySelector('.note-actions .badge')?.textContent).toBe('引用命中 1/2')
    const uncited = mount(<NoteViewer note={NOTE} attachmentManifest={[ATTACHMENT]} getAttachment={(ref) => (ref === ATTACHMENT.ref ? ATTACHMENT : null)} />)
    expect(uncited.querySelector('.note-actions .badge')).toBeNull()
  })

  it('distinguishes «selected lesson has no note» from the library (批2 A7)', () => {
    const onGoTasks = vi.fn()
    const library = [
      { lessonId: 'l2', version: 1, createdAt: '2026-09-04T00:00:00Z', courseId: 'c1', courseName: '算法', teacher: null, lessonTitle: '第2节课' }
    ]
    const host = mount(<NoteViewer note={null} lesson={{ courseName: '算法', lessonTitle: '第1节课' }} library={library} onOpenLesson={() => undefined} onGoTasks={onGoTasks} />)
    expect(host.querySelector('[data-testid="note-empty-current"]')).not.toBeNull()
    expect(host.textContent).toContain('「第1节课」尚无笔记')
    const goButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '去创建任务')
    click(goButton ?? null)
    expect(onGoTasks).toHaveBeenCalledTimes(1)
    // The library stays reachable below.
    expect(host.querySelector('[data-testid="note-library"]')).not.toBeNull()
    expect(host.textContent).toContain('或打开其他笔记')
  })

  it('navigates to the previous/next lesson via the toolbar (批2 B4)', () => {
    const onNavigate = vi.fn()
    const host = mount(
      <NoteViewer
        note={NOTE}
        prevLesson={{ id: 'l0', title: '第0节课' }}
        nextLesson={null}
        onNavigateLesson={onNavigate}
      />
    )
    const prev = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '‹ 上一节')
    const next = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '下一节 ›')
    click(prev ?? null)
    expect(onNavigate).toHaveBeenCalledWith('l0')
    expect((next as HTMLButtonElement | undefined)?.disabled).toBe(true)
  })

  it('hides the lesson nav when no neighbors are provided', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    expect(host.querySelector('.lesson-nav')).toBeNull()
  })
  it('shows the cross-lesson note library grouped by course (批B + 批6)', () => {
    const onOpenLesson = vi.fn()
    const library = [
      { lessonId: 'l2', version: 3, createdAt: '2026-09-04T02:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第2节课' }
    ]
    const host = mount(
      <NoteViewer
        note={null}
        library={library}
        onOpenLesson={onOpenLesson}
        onUpgradeCourse={() => undefined}
        onExportCourseObsidian={() => undefined}
      />
    )
    // A3 (plan 2026-09-13): a non-empty library must NOT sit under a «尚无笔记»
    // hero card — a one-line hint leads instead, and the hero only exists when
    // the library is truly empty.
    expect(host.querySelector('.note-viewer .empty-state')).toBeNull()
    expect(host.querySelector('.note-viewer .msg')?.textContent).toContain('笔记在任务生成后自动显示')
    expect(host.querySelector('.subheading')?.textContent).toContain('全部笔记')
    // 批C: 未截断时标题写总数（数字由数据算出来，不再硬编码「最近 200 条」）。
    expect(host.querySelector('.subheading')?.textContent).toContain('共 1 条')
    // 批6: the course identity lives on the group head; the row carries the lesson.
    const group = host.querySelector('.note-library-group-head')
    expect(group?.textContent).toContain('算法导论 · 汪海')
    expect(group?.textContent).toContain('1')
    // A2 (plan 2026-09-13): both group actions live in ONE right-flush cluster,
    // so their edges align across groups no matter how long the course name is.
    const actions = host.querySelector('.note-library-group-head .note-library-actions')
    expect(actions?.textContent).toContain('导出 Obsidian')
    expect(actions?.textContent).toContain('升级旧笔记')
    expect(host.querySelectorAll('.note-library-group-head > button')).toHaveLength(1)
    const row = host.querySelector('[data-testid="note-library-row"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain('第2节课')
    expect(row?.querySelector('.badge')?.getAttribute('title')).toBe('第 3 次生成')
    click(row)
    expect(onOpenLesson).toHaveBeenCalledWith('l2')
  })

  it('批C: 笔记库被截断时标题说出总数与出路（不再静默丢弃）', () => {
    const library = [
      { lessonId: 'l1', version: 1, createdAt: '2026-09-08T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' }
    ]
    const host = mount(<NoteViewer note={null} library={library} libraryTotal={431} onOpenLesson={() => undefined} />)
    const heading = host.querySelector('.subheading')?.textContent ?? ''
    expect(heading).toContain('共 431 条')
    expect(heading).toContain('这里显示最近 1 条')
    // 出路：更早的笔记去哪找。
    expect(heading).toContain('课程树')
  })

  it('批C 批2: 笔记库搜索——输入回调、命中标题、无命中空态、命中组自动展开', () => {
    const library = [
      { lessonId: 'l1', version: 1, createdAt: '2026-09-08T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' },
      { lessonId: 'l2', version: 1, createdAt: '2026-09-08T00:00:00Z', courseId: 'c2', courseName: '编译原理', teacher: '李雷', lessonTitle: '第二讲' }
    ]
    const onQuery = vi.fn()
    const host = mount(<NoteViewer note={null} library={library} libraryTotal={2} libraryQuery="" onLibraryQuery={onQuery} onOpenLesson={() => undefined} />)
    // 搜索框存在且口径写在 placeholder 里（只搜列表看得见的字段）。
    const box = host.querySelector<HTMLInputElement>('.note-library-search')
    expect(box).not.toBeNull()
    expect(box?.getAttribute('placeholder')).toContain('课程 / 教师 / 课时')
    // 批4 a11y: 与 MindMap 搜索框同款——读屏用户听到的不再是「编辑框」。
    expect(box?.getAttribute('aria-label')).toBe('搜索笔记')

    // 输入 → 回调（过滤在主进程做，组件只上报）。
    input(box, '编译')
    expect(onQuery).toHaveBeenCalledWith('编译')

    // 搜索时标题说匹配数（而不是「共 N 条」，那会被误读成库里的总数）。
    const searching = mount(<NoteViewer note={null} library={[library[1]!]} libraryTotal={1} libraryQuery="编译" onLibraryQuery={onQuery} onOpenLesson={() => undefined} />)
    expect(searching.querySelector('.subheading')?.textContent).toContain('「编译」匹配 1 条笔记')

    // 无命中 → 一行空态，不留空白。
    const empty = mount(<NoteViewer note={null} library={[]} libraryTotal={0} libraryQuery="不存在的词" onLibraryQuery={onQuery} onOpenLesson={() => undefined} />)
    expect(empty.textContent).toContain('没有匹配的笔记')
  })

  it('批C 批2: 搜索时命中的分组一律展开（搜到了却看不见等于没搜到）', () => {
    const library = [
      { lessonId: 'l1', version: 1, createdAt: '2026-09-08T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' }
    ]
    const host = mount(<NoteViewer note={null} library={library} libraryTotal={1} libraryQuery="" onLibraryQuery={() => undefined} onOpenLesson={() => undefined} />)
    // 先手动收起该分组。
    click(host.querySelector('.note-library-group-toggle'))
    expect(host.querySelector('[data-testid="note-library-row"]')).toBeNull()
    // 带搜索词重挂载：即使 collapsed 集合是空的，也要展开。
    const searching = mount(<NoteViewer note={null} library={library} libraryTotal={1} libraryQuery="算法" onLibraryQuery={() => undefined} onOpenLesson={() => undefined} />)
    expect(searching.querySelector('[data-testid="note-library-row"]')).not.toBeNull()
  })

  it('批C 批3: 列表没取完时给「显示更多」，取完了就不给', () => {
    const library = [
      { lessonId: 'l1', version: 1, createdAt: '2026-09-08T00:00:00Z', courseId: 'c1', courseName: '算法导论', teacher: '汪海', lessonTitle: '第一讲' }
    ]
    const onMore = vi.fn()
    const truncated = mount(<NoteViewer note={null} library={library} libraryTotal={431} onLibraryMore={onMore} onOpenLesson={() => undefined} />)
    const more = [...truncated.querySelectorAll('button')].find((b) => b.textContent?.includes('显示更多'))
    expect(more?.textContent).toContain('还有 430 条')
    click(more ?? null)
    expect(onMore).toHaveBeenCalled()

    // 取完了（total === entries.length）→ 没有按钮，不留一个「还有 0 条」。
    const complete = mount(<NoteViewer note={null} library={library} libraryTotal={1} onLibraryMore={onMore} onOpenLesson={() => undefined} />)
    expect([...complete.querySelectorAll('button')].some((b) => b.textContent?.includes('显示更多'))).toBe(false)
  })

  it('keeps the plain empty hint when the library is empty', () => {
    const host = mount(<NoteViewer note={null} library={[]} onOpenLesson={() => undefined} />)
    expect(host.querySelector('[data-testid="note-library"]')).toBeNull()
    expect(host.querySelector('.subheading')).toBeNull()
    expect(host.textContent).toContain('尚无笔记')
  })
})

describe('NoteViewer M2.2 导图跳转', () => {
  const ANCHORED: Note = {
    ...NOTE,
    knowledgeTree: { title: '复杂度', children: [{ title: '记号', terms: ['大O'], children: [] }] }
  }

  const switchTo = (host: HTMLElement, label: string): void => {
    const tab = Array.from(host.querySelectorAll('.note-tabs button')).find((b) => b.textContent === label) ?? null
    click(tab)
  }

  it('detailed concept cards carry the data-concept-term anchor', () => {
    const host = mount(<NoteViewer note={ANCHORED} />)
    const card = host.querySelector('[data-concept-term="大O"]')
    expect(card).not.toBeNull()
    expect(card?.classList.contains('concept-card')).toBe(true)
  })

  it('mind map ℹ️ popover jumps back to the detailed view via the tab', () => {
    const host = mount(<NoteViewer note={ANCHORED} />)
    switchTo(host, '思维导图')
    expect(host.querySelector('[data-testid="mindmap"]')).not.toBeNull()
    click(host.querySelector('.mindmap-info'))
    expect(host.querySelector('[data-testid="mindmap-popover"]')).not.toBeNull()
    const jump = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '在详细笔记中查看') ?? null
    click(jump)
    // Back on the detailed view — the anchored concept card is on screen.
    expect(host.querySelector('.note-body')?.getAttribute('data-view')).toBe('detailed')
    expect(host.querySelector('[data-concept-term="大O"]')).not.toBeNull()
  })
})

describe('NoteViewer 批6 阅读细节', () => {
  it('a single-ref stamp renders as a passive label, not a dead toggle button', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    const stamp = host.querySelector('.timeline-card .timeline-stamp')
    expect(stamp?.tagName).toBe('SPAN')
  })

  it('the image zoom dialog is a view dialog: one 关闭 action, no 取消 pair', () => {
    const host = mount(<NoteViewer note={NOTE} attachmentManifest={[ATTACHMENT]} getAttachment={(ref) => (ref === ATTACHMENT.ref ? ATTACHMENT : null)} />)
    click(host.querySelector('.timeline-thumb') ?? null)
    const dialog = host.querySelector('.dialog')
    expect(dialog).not.toBeNull()
    // Human title: entry title + timestamp, not the raw ref.
    expect(dialog?.querySelector('.dialog-title')?.textContent).toContain('示例')
    expect(dialog?.querySelector('.dialog-title')?.textContent).toContain('05:00')
    const actions = host.querySelectorAll('.dialog-actions button')
    expect(actions).toHaveLength(1)
    expect(actions[0]?.textContent).toBe('关闭')
  })

  it('concept-card timestamps are locate buttons aimed at the timeline', () => {
    const anchored: Note = {
      ...NOTE,
      concepts: [{ term: '大O', definition: '渐进上界', refs: [{ at: 65, text: '第 1 分钟讲到' }] }]
    }
    const host = mount(<NoteViewer note={anchored} />)
    const stamp = host.querySelector('button.concept-ref')
    expect(stamp).not.toBeNull()
    expect(stamp?.getAttribute('title')).toContain('定位到时间线')
  })
})

describe('NoteViewer 健康巡查 2026-09-12 批5 (export busy feedback)', () => {
  it('export buttons disable while an export runs; the running one reads 导出中…', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        onExport={() => undefined}
        onExportAnki={() => undefined}
        onExportObsidian={() => undefined}
        onExportSvg={() => undefined}
        exportBusy="markdown"
      />
    )
    const byLabel = (label: string): HTMLButtonElement | null =>
      Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement | null
    // The running export's button swapped its label; the rest just disable.
    expect(byLabel('导出中…')?.disabled).toBe(true)
    expect(byLabel('导出 Markdown')).toBeUndefined()
    expect(byLabel('导出 Anki')?.disabled).toBe(true)
    expect(byLabel('导出 Obsidian')?.disabled).toBe(true)
  })

  it('idle state keeps the plain labels enabled', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        onExport={() => undefined}
        onExportAnki={() => undefined}
        onExportObsidian={() => undefined}
        exportBusy={null}
      />
    )
    const markdown = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '导出 Markdown') as HTMLButtonElement
    expect(markdown.disabled).toBe(false)
  })
})

describe('NoteViewer 批4 渲染层 memo 与 a11y', () => {
  it('memo 化后一次无关 state 变更（开合体检面板）不重复解析、不重复投影', () => {
    const parseSpy = vi.mocked(parseInline)
    const projectSpy = vi.mocked(projectNoteBlocks)
    parseSpy.mockClear()
    projectSpy.mockClear()
    const host = mount(<NoteViewer note={NOTE} />)
    const parsesAtMount = parseSpy.mock.calls.length
    const projectionsAtMount = projectSpy.mock.calls.length
    expect(parsesAtMount).toBeGreaterThan(0)
    expect(projectionsAtMount).toBeGreaterThan(0)
    // 无关 state 变更：开合体检面板（note 与全部 props 原样不动）。
    click(host.querySelector('.note-health-toggle'))
    expect(parseSpy.mock.calls.length).toBe(parsesAtMount)
    expect(projectSpy.mock.calls.length).toBe(projectionsAtMount)
  })

  it('批4 a11y: 五视图内容面板是 tabpanel，与激活 tab 双向 aria 关联', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    const panel = host.querySelector('.note-body')!
    expect(panel.getAttribute('role')).toBe('tabpanel')
    const active = host.querySelector('.note-tabs button.active') as HTMLButtonElement
    expect(panel.getAttribute('aria-labelledby')).toBe(active.id)
    expect(active.getAttribute('aria-controls')).toBe(panel.id)
    // 每个 tab 有唯一 id 且都指向同一个面板。
    const tabs = [...host.querySelectorAll('.note-tabs button')] as HTMLButtonElement[]
    expect(new Set(tabs.map((t) => t.id)).size).toBe(tabs.length)
    for (const t of tabs) expect(t.getAttribute('aria-controls')).toBe(panel.id)
    // 切视图后面板不倒，关联跟着激活的 tab 走。
    const mindmapTab = tabs.find((b) => b.textContent === '思维导图')!
    click(mindmapTab)
    const active2 = host.querySelector('.note-tabs button.active') as HTMLButtonElement
    expect(active2.textContent).toBe('思维导图')
    expect(host.querySelector('.note-body')!.getAttribute('aria-labelledby')).toBe(active2.id)
  })
})


describe('NoteViewer 封面 banner（批 A2, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('封面优先：coverDataUrl 直接当 banner', () => {
    const host = mount(<NoteViewer note={NOTE} lesson={lesson} coverDataUrl="data:image/jpeg;base64,Y292ZXI=" />)
    const cover = host.querySelector('.note-cover')
    expect(cover?.getAttribute('src')).toBe('data:image/jpeg;base64,Y292ZXI=')
  })

  it('无封面 → 退回 manifest 里最早的关键帧', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        lesson={lesson}
        attachmentManifest={[
          { ref: 'kf:kf-9', at: 900 },
          { ref: 'kf:kf-3', at: 300 }
        ]}
        getAttachment={(ref: string) => (ref === 'kf:kf-3' ? ATTACHMENT : null)}
      />
    )
    expect(host.querySelector('.note-cover')?.getAttribute('src')).toBe(ATTACHMENT.dataUrl)
  })

  it('两者皆无 → 不渲染 banner（SEU 源合法无封面态）', () => {
    const host = mount(<NoteViewer note={NOTE} lesson={lesson} />)
    expect(host.querySelector('.note-cover')).toBeNull()
  })

  // 批3 (plan 2026-09-20, P1/D8): 封面回填入口——只在「B 站源 + 没有落库封面」时出现，
  // SEU 源不给会失败的按钮（平台本来就没有封面）。
  it('B 站源且无封面 → 出现「重新获取封面」，点击触发回填', () => {
    const onBackfillCover = vi.fn()
    const host = mount(
      <NoteViewer note={NOTE} lesson={lesson} courseSource="bilibili" onBackfillCover={onBackfillCover} />
    )
    const button = host.querySelector<HTMLButtonElement>('.note-cover-backfill')
    expect(button?.textContent).toBe('重新获取封面')
    expect(button?.disabled).toBe(false)
    click(button)
    expect(onBackfillCover).toHaveBeenCalledTimes(1)
  })

  it('SEU 源不给这个入口；已有封面时也不给（没什么可补的）', () => {
    const seu = mount(<NoteViewer note={NOTE} lesson={lesson} courseSource="seu" onBackfillCover={() => undefined} />)
    expect(seu.querySelector('.note-cover-backfill')).toBeNull()
    const covered = mount(
      <NoteViewer
        note={NOTE}
        lesson={lesson}
        courseSource="bilibili"
        coverDataUrl="data:image/jpeg;base64,Y292ZXI="
        onBackfillCover={() => undefined}
      />
    )
    expect(covered.querySelector('.note-cover-backfill')).toBeNull()
  })

  it('回填在途：按钮读「获取中…」并禁用（busy 三件套）', () => {
    const onBackfillCover = vi.fn()
    const host = mount(
      <NoteViewer
        note={NOTE}
        lesson={lesson}
        courseSource="bilibili"
        coverBackfillBusy
        onBackfillCover={onBackfillCover}
      />
    )
    const button = host.querySelector<HTMLButtonElement>('.note-cover-backfill')
    expect(button?.textContent).toBe('获取中…')
    expect(button?.disabled).toBe(true)
    click(button)
    expect(onBackfillCover).not.toHaveBeenCalled()
  })
})

describe('NoteViewer 时间线章节分组（B1, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('有 chapters → 时间线渲染章头（时间 + 标题 + 一句话）', () => {
    const note: Note = {
      ...NOTE,
      chapters: [
        { at: 0, title: '开场', summary: '回顾上讲' },
        { at: 200, title: 'ε-δ 定义', summary: '严格定义引入' }
      ]
    }
    const host = mount(<NoteViewer note={note} lesson={lesson} />)
    const heads = host.querySelectorAll('.timeline-chapter')
    expect(heads).toHaveLength(2)
    expect(heads[0]?.querySelector('.timeline-chapter-title')?.textContent).toBe('开场')
    expect(heads[1]?.querySelector('.timeline-chapter-summary')?.textContent).toBe('严格定义引入')
    expect(host.textContent).toContain('03:20')
  })

  it('无 chapters → 不渲染章头（旧笔记逐字节不变）', () => {
    const host = mount(<NoteViewer note={NOTE} lesson={lesson} />)
    expect(host.querySelectorAll('.timeline-chapter')).toHaveLength(0)
    expect(host.querySelectorAll('.timeline-card')).toHaveLength(NOTE.timeline.length)
  })
})

describe('NoteViewer 金句 pull-quote（B2, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('有 quotes → 渲染金句节（时间徽章 + 引文）', () => {
    const note: Note = { ...NOTE, quotes: [{ at: 300, text: '极限是一种态度' }] }
    const host = mount(<NoteViewer note={note} lesson={lesson} />)
    const pull = host.querySelector('.quote-pull')
    expect(pull).not.toBeNull()
    expect(pull?.querySelector('.quote-pull-at')?.textContent).toBe('05:00')
    expect(pull?.querySelector('.quote-pull-text')?.textContent).toContain('极限是一种态度')
  })

  it('无 quotes → 不渲染金句节', () => {
    const host = mount(<NoteViewer note={NOTE} lesson={lesson} />)
    expect(host.querySelector('.quote-pull')).toBeNull()
  })
})

describe('NoteViewer 断供可见化（A3, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('无任何素材时图集空态说出原因与出路（不再是一行灰字）', () => {
    const host = mount(<NoteViewer note={NOTE} lesson={lesson} />)
    const empty = host.querySelector('.evidence-gallery')
    // gallery 为 null 时渲染说明段（证据节的兜底分支）。
    const text = empty?.textContent ?? host.textContent ?? ''
    if (empty == null) {
      expect(text).toContain('没有可用画面素材')
      expect(text).toContain('重新运行任务')
    }
  })
})

describe('NoteViewer 封面区章节 chips + 阅读时长（C1, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('有 chapters → 渲染 chips（标题 + 时间 tooltip）与阅读时长', () => {
    const note: Note = { ...NOTE, chapters: [{ at: 0, title: '开场', summary: '回顾' }, { at: 200, title: 'ε-δ 定义', summary: '严格定义' }] }
    const host = mount(<NoteViewer note={note} lesson={lesson} />)
    const chips = host.querySelectorAll('.chapter-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0]?.textContent).toBe('开场')
    expect(chips[1]?.getAttribute('title')).toContain('严格定义')
    expect(host.querySelector('.note-readtime')?.textContent).toMatch(/约 \d+ 分钟读完/)
  })

  it('无 chapters → 不渲染 chips；阅读时长仍在', () => {
    const host = mount(<NoteViewer note={NOTE} lesson={lesson} />)
    expect(host.querySelectorAll('.chapter-chip')).toHaveLength(0)
    expect(host.querySelector('.note-readtime')).not.toBeNull()
  })

  it('点 chip 跳到对应章头（scrollIntoView 存在性守卫，happy-dom 不炸）', () => {
    const note: Note = { ...NOTE, chapters: [{ at: 200, title: 'ε-δ 定义', summary: '严格定义' }] }
    const host = mount(<NoteViewer note={note} lesson={lesson} />)
    const chip = host.querySelector('.chapter-chip') as HTMLButtonElement
    expect(() => click(chip)).not.toThrow()
  })
})

describe('NoteViewer 图文并排卡片（C4, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }
  const withImages: Note = {
    ...NOTE,
    timeline: [
      { at: 65, title: '引入', detail: '开始讲解', refs: [{ at: 66, text: '讲者原话：复杂度是算法的灵魂。' }], evidence: [{ kind: 'keyframe', ref: 'kf:kf-3' }] },
      { at: 300, title: '示例', detail: '举例说明', refs: [], evidence: [] }
    ]
  }

  it('有条目配到图 → 卡片通 has-images 且拆出 body/side 两列', () => {
    const host = mount(
      <NoteViewer
        note={withImages}
        lesson={lesson}
        attachmentManifest={[{ ref: 'kf:kf-3', at: 300 }]}
        getAttachment={(ref: string) => (ref === 'kf:kf-3' ? ATTACHMENT : null)}
      />
    )
    const card = host.querySelector('.timeline-card.has-images')
    expect(card).not.toBeNull()
    expect(card?.querySelector('.timeline-body')).not.toBeNull()
    expect(card?.querySelector('.timeline-side .timeline-thumb')).not.toBeNull()
  })

  it('无图卡片的首条摘引升 hero（视觉补位）', () => {
    const host = mount(<NoteViewer note={withImages} lesson={lesson} attachmentManifest={[]} getAttachment={() => null} />)
    expect(host.querySelector('.timeline-card.has-images')).toBeNull()
    expect(host.querySelector('.timeline-quote.hero')).not.toBeNull()
  })
})

describe('NoteViewer 图集近重复折叠（A6, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('哈希相同的两张参考帧折成一组，caption 显示「N 张近重复」', () => {
    const hash = '0'.repeat(64)
    const host = mount(
      <NoteViewer
        note={NOTE}
        lesson={lesson}
        attachmentManifest={[
          { ref: 'kf:a', at: 0, hash },
          { ref: 'kf:b', at: 10, hash }
        ]}
        getAttachment={(ref: string) => ({ ref, kind: 'keyframe' as const, at: 0, dataUrl: `data:image/jpeg;base64,${ref}` })}
      />
    )
    const groups = host.querySelectorAll('[data-testid="gallery-group"]')
    expect(groups).toHaveLength(1)
    const fold = groups[0]?.querySelector('.evidence-fold')
    expect(fold?.textContent).toBe('2 张近重复')
  })

  it('无 hash 的 manifest → 不折叠（平铺）', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        lesson={lesson}
        attachmentManifest={[
          { ref: 'kf:a', at: 0 },
          { ref: 'kf:b', at: 10 }
        ]}
        getAttachment={(ref: string) => ({ ref, kind: 'keyframe' as const, at: 0, dataUrl: `data:image/jpeg;base64,${ref}` })}
      />
    )
    expect(host.querySelectorAll('[data-testid="gallery-group"]')).toHaveLength(2)
  })
})

describe('NoteViewer sticky 目录（C3, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('详细视图有章节/概念时渲染 sticky 目录（章 + 概念条目）', () => {
    const note: Note = { ...NOTE, chapters: [{ at: 200, title: 'ε-δ 定义', summary: '严格定义' }] }
    const host = mount(<NoteViewer note={note} lesson={lesson} />)
    const toc = host.querySelector('.note-toc-sticky')
    expect(toc).not.toBeNull()
    expect(toc?.querySelectorAll('.toc-item').length).toBe(1 + note.concepts.length)
    expect(toc?.textContent).toContain('ε-δ 定义')
    expect(toc?.textContent).toContain('大O')
  })

  it('无章节无概念 → 不渲染目录条', () => {
    const bare: Note = { ...NOTE, concepts: [] }
    const host = mount(<NoteViewer note={bare} lesson={lesson} />)
    expect(host.querySelector('.note-toc-sticky')).toBeNull()
  })

  it('点章条目不抛（scrollIntoView 存在性守卫）', () => {
    const note: Note = { ...NOTE, chapters: [{ at: 0, title: '开场', summary: '回顾' }] }
    const host = mount(<NoteViewer note={note} lesson={lesson} />)
    const item = host.querySelector('.toc-item') as HTMLButtonElement
    expect(() => click(item)).not.toThrow()
  })
})

describe('NoteViewer 章节胶片条（C5, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('有章节 + 有参考帧 → 图集按章分组成横向胶片条', () => {
    const note: Note = { ...NOTE, chapters: [{ at: 0, title: '开场', summary: '回顾' }, { at: 300, title: 'ε-δ 定义', summary: '严格定义' }] }
    const host = mount(
      <NoteViewer
        note={note}
        lesson={lesson}
        attachmentManifest={[
          { ref: 'kf:a', at: 100 },
          { ref: 'kf:b', at: 500 }
        ]}
        getAttachment={(ref: string) => ({ ref, kind: 'keyframe' as const, at: 0, dataUrl: `data:image/jpeg;base64,${ref}` })}
      />
    )
    const groups = host.querySelectorAll('.gallery-chapter')
    expect(groups.length).toBe(2)
    expect(groups[0]?.querySelector('.gallery-chapter-title')?.textContent).toContain('开场')
    expect(groups[0]?.querySelector('.gallery-strip')).not.toBeNull()
    expect(host.querySelector('[data-testid="gallery-chapters"]')).not.toBeNull()
  })

  it('无章节 → 仍是原折叠网格（零回归）', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        lesson={lesson}
        attachmentManifest={[{ ref: 'kf:a', at: 100 }]}
        getAttachment={(ref: string) => ({ ref, kind: 'keyframe' as const, at: 0, dataUrl: `data:image/jpeg;base64,${ref}` })}
      />
    )
    expect(host.querySelector('[data-testid="gallery-chapters"]')).toBeNull()
    expect(host.querySelector('[data-testid="evidence-gallery"]')).not.toBeNull()
  })
})

describe('NoteViewer 兜底封面帧挑选（回购修正, plan 2026-09-19）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('无封面数据 URL → 取 60 秒后的第一帧当兜底（越过 0s 标题页）', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        lesson={lesson}
        attachmentManifest={[
          { ref: 'kf:title', at: 0 },
          { ref: 'kf:m1', at: 40 },
          { ref: 'kf:m2', at: 300 }
        ]}
        getAttachment={(ref: string) => ({ ref, kind: 'keyframe' as const, at: 0, dataUrl: `data:image/jpeg;base64,${ref}` })}
      />
    )
    expect(host.querySelector('.note-cover')?.getAttribute('src')).toBe('data:image/jpeg;base64,kf:m2')
  })

  it('全部早于 60 秒 → 退最后一张（好过没有）', () => {
    const host = mount(
      <NoteViewer
        note={NOTE}
        lesson={lesson}
        attachmentManifest={[
          { ref: 'kf:a', at: 0 },
          { ref: 'kf:b', at: 40 }
        ]}
        getAttachment={(ref: string) => ({ ref, kind: 'keyframe' as const, at: 0, dataUrl: `data:image/jpeg;base64,${ref}` })}
      />
    )
    expect(host.querySelector('.note-cover')?.getAttribute('src')).toBe('data:image/jpeg;base64,kf:b')
  })
})

describe('NoteViewer 目录条目完整性（回购强化）', () => {
  const lesson = { courseName: '算法导论', teacher: '汪海', lessonTitle: '第五讲' }

  it('目录条目数 = 章节数 + 概念数（一个都不能漏）', () => {
    const note: Note = {
      ...NOTE,
      chapters: [{ at: 0, title: '开场', summary: 's1' }, { at: 300, title: '定义', summary: 's2' }],
      concepts: [
        { term: '大O', definition: 'd1', refs: [] },
        { term: '复杂度', definition: 'd2', refs: [] },
        { term: '渐进', definition: 'd3', refs: [] }
      ]
    }
    const host = mount(<NoteViewer note={note} lesson={lesson} />)
    const items = host.querySelectorAll('.note-toc-sticky .toc-item')
    expect(items).toHaveLength(2 + 3)
    const texts = [...items].map((el) => el.textContent ?? '')
    for (const term of ['大O', '复杂度', '渐进']) expect(texts.some((t) => t.includes(term))).toBe(true)
  })
})

describe('批 D (plan 2026-09-19): 跳原片（B 站 ?t=）', () => {
  it('onOpenSource 给了才渲染「原片」钮，点击带条目 at', () => {
    const onOpenSource = vi.fn()
    const host = mount(<NoteViewer note={NOTE} onOpenSource={onOpenSource} />)
    const btn = host.querySelector('.timeline-card .timeline-open-src')
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toContain('原片')
    click(btn!)
    expect(onOpenSource).toHaveBeenCalledWith(65)
  })

  it('不给 onOpenSource（SEU 源）时按钮不渲染', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    expect(host.querySelector('.timeline-open-src')).toBeNull()
  })
})

describe('批2 (plan 2026-09-20, P2): 体检面板的「按体检结果补全」', () => {
  function openHealthPanel(props: Record<string, unknown>): HTMLElement {
    const host = mount(<NoteViewer note={NOTE} {...props} />)
    click(host.querySelector('.note-health-toggle'))
    return host
  }

  it('给了 onRepair 时与「重新生成此笔记」并列出现，点击回调一次', () => {
    const onRepair = vi.fn()
    const host = openHealthPanel({ onRepair, onRegenerate: () => undefined })
    const repair = host.querySelector('.note-repair-btn') as HTMLButtonElement
    expect(repair).not.toBeNull()
    expect(repair.textContent).toBe('按体检结果补全')
    // 语义不同：一个按体检问题修、一个重出整稿——title 说明边界（不发画面、修不好保留原稿）。
    expect(repair.getAttribute('title')).toContain('不重新发送画面')
    expect(repair.disabled).toBe(false)
    click(repair)
    expect(onRepair).toHaveBeenCalledTimes(1)
  })

  it('不给 onRepair 时不渲染该按钮（不给会失败的入口）', () => {
    const host = openHealthPanel({ onRegenerate: () => undefined })
    expect(host.querySelector('.note-repair-btn')).toBeNull()
  })

  it('在途时按钮 disabled 且文案加省略号；与重新生成互锁（同一课时只允许一路写）', () => {
    const host = openHealthPanel({ onRepair: () => undefined, repairBusy: true, onRegenerate: () => undefined })
    const repair = host.querySelector('.note-repair-btn') as HTMLButtonElement
    expect(repair.disabled).toBe(true)
    expect(repair.textContent).toBe('补全中…')
    const regenerate = [...host.querySelectorAll('.note-health-panel button')].find((b) => b.textContent?.includes('重新生成')) as HTMLButtonElement
    expect(regenerate.disabled).toBe(true)
  })
})

describe('批2 (plan 2026-09-20, P7): 体检徽标与升级列表同源（转写命中率由 main 带进来）', () => {
  /** 形状完全达标的稿——唯一可能的 warn 来自外部带进来的命中率。 */
  const COMPLIANT: Note = {
    chapters: [],
    quotes: [],
    overview: `## 本讲主线\n${'很长的主线叙述，覆盖本讲完整的知识推进与演示结果。'.repeat(6)}`,
    knowledgeTree: {
      title: '机器学习工程实践',
      children: [
        { title: '数据处理', children: [{ title: '加载与划分', children: [{ title: '张量批处理', children: [] }] }] },
        { title: '模型构建', children: [{ title: '线性分类器', children: [{ title: '前向传播', children: [] }] }] },
        { title: '训练调优', children: [{ title: '超参数搜索', children: [{ title: '容量控制', children: [] }] }] }
      ]
    },
    timeline: [
      {
        at: 0,
        title: '超参数调整演示',
        detail:
          '把模型宽度从 32 改到 64 之后，测试集精度由 0.97 回落到 0.87，训练集精度却继续上升，说明在这个数据量下容量过大已经明显过拟合。',
        refs: [],
        evidence: []
      }
    ],
    concepts: [
      {
        term: '学习率',
        definition:
          '优化算法中的步长参数，控制每次参数更新的幅度；过大会导致损失震荡难以收敛，过小则收敛速度极慢，通常需要配合学习率调度器在训练过程中动态调整。',
        refs: []
      }
    ],
    formulasAndSteps: [],
    methodology: 'm',
    examCues: ['手推交叉熵损失的梯度公式'],
    questionsAndGaps: ['讲者留下的作业：完成模块化重构'],
    quiz: [
      { question: '学习率过大有什么后果?', answer: '损失震荡难以收敛。', source: 'concept', term: '学习率' },
      { question: '容量过大在本数据集上的表现是什么?', answer: '训练精度上升而测试精度回落。', source: 'concept', term: '学习率' },
      { question: '讲者建议的宽度取值是多少?', answer: '先压回 32。', source: 'concept', term: '学习率' },
      { question: '过拟合在本讲的判据是什么?', answer: '训练与测试精度走势背离。', source: 'concept', term: '学习率' },
      { question: '讲者给出的容量控制手段是什么?', answer: '减小模型宽度。', source: 'concept', term: '学习率' }
    ],
    conceptLinks: [],
    transcriptRefs: [],
    evidence: []
  }

  it('没有命中率（或命中率达标）时徽标是「体检：良好」', () => {
    const host = mount(<NoteViewer note={COMPLIANT} />)
    expect(host.querySelector('.note-health-toggle')?.textContent).toBe('体检：良好')
    const withGoodRate = mount(<NoteViewer note={COMPLIANT} noteTranscriptHitRate={{ hits: 3, total: 3 }} />)
    expect(withGoodRate.querySelector('.note-health-toggle')?.textContent).toBe('体检：良好')
  })

  it('只有转写命中率不达标时也报「待改进」，并在体检面板里点名「转写摘引」', () => {
    const host = mount(<NoteViewer note={COMPLIANT} noteTranscriptHitRate={{ hits: 0, total: 1 }} />)
    expect(host.querySelector('.note-health-toggle')?.textContent).toBe('体检：1 项待改进')
    click(host.querySelector('.note-health-toggle'))
    const panel = host.querySelector('.note-health-panel')
    expect(panel?.textContent).toContain('转写摘引')
    expect(panel?.textContent).toContain('0/1')
  })
})
