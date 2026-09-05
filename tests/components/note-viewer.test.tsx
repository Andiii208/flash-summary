import { describe, expect, it, vi } from 'vitest'
import { NoteViewer } from '../../src/renderer/components/NoteViewer'
import { mount, click } from '../helpers/preact'
import type { Note } from '../../src/shared/notes/schema'

const NOTE: Note = {
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

  it('binds the nearest keyframe onto a timeline card without evidence refs', () => {
    const host = mount(<NoteViewer note={NOTE} attachmentManifest={[ATTACHMENT]} getAttachment={(ref) => (ref === ATTACHMENT.ref ? ATTACHMENT : null)} />)
    const card = host.querySelectorAll('.timeline-card')[1]!
    expect(card.querySelector('.timeline-thumb img')?.getAttribute('src')).toBe(ATTACHMENT.dataUrl)
    expect(card.querySelector('.thumb-origin')?.textContent).toBe('就近')
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
    expect(cards[0]!.querySelector('.quiz-hint')).toBeNull()
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
      { lessonId: 'l2', version: 1, createdAt: '2026-09-04T00:00:00Z', courseName: '算法', teacher: null, lessonTitle: '第2节课' }
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
  it('shows the cross-lesson note library instead of the dead empty state (批B)', () => {
    const onOpenLesson = vi.fn()
    const library = [
      { lessonId: 'l2', version: 3, createdAt: '2026-09-04T02:00:00Z', courseName: '算法导论', teacher: '汪海', lessonTitle: '第2节课' }
    ]
    const host = mount(<NoteViewer note={null} library={library} onOpenLesson={onOpenLesson} />)
    // 2026-09-05: home empty state mirrors the tasks tab — guide card, then
    // the library under its own subheading (the bare .msg line is gone).
    expect(host.querySelector('.note-body .empty-state')).not.toBeNull()
    expect(host.querySelector('.subheading')?.textContent).toContain('全部笔记')
    const row = host.querySelector('[data-testid="note-library-row"]')
    expect(row).not.toBeNull()
    expect(row?.textContent).toContain('算法导论 · 汪海 — 第2节课')
    expect(row?.textContent).toContain('v3')
    click(row)
    expect(onOpenLesson).toHaveBeenCalledWith('l2')
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
