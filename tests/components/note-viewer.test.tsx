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
    const host = mount(<NoteViewer note={NOTE} attachments={[ATTACHMENT]} />)
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

  it('renders the evidence gallery section in the detailed view', () => {
    const host = mount(<NoteViewer note={NOTE} attachments={[ATTACHMENT]} />)
    expect(host.querySelector('[data-testid="evidence-gallery"]')).not.toBeNull()
    expect(host.querySelector('.evidence-fig img')?.getAttribute('src')).toBe(ATTACHMENT.dataUrl)
  })

  it('shows the citation hit badge when evidence refs resolve, hides with none cited', () => {
    const citedNote: Note = {
      ...NOTE,
      timeline: [
        { at: 10, title: 'a', detail: 'd', refs: [], evidence: [{ kind: 'keyframe', ref: 'kf:kf-3' }] },
        { at: 20, title: 'b', detail: 'd', refs: [], evidence: [{ kind: 'keyframe', ref: 'kf:missing.1' }] }
      ]
    }
    const host = mount(<NoteViewer note={citedNote} attachments={[ATTACHMENT]} />)
    expect(host.querySelector('.note-actions .badge')?.textContent).toBe('引用命中 1/2')
    const uncited = mount(<NoteViewer note={NOTE} attachments={[ATTACHMENT]} />)
    expect(uncited.querySelector('.note-actions .badge')).toBeNull()
  })
})
