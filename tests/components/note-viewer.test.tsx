import { describe, expect, it } from 'vitest'
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

describe('NoteViewer', () => {
  it('shows the placeholder when there is no note', () => {
    const host = mount(<NoteViewer note={null} />)
    expect(host.textContent).toContain('尚无笔记')
  })

  it('renders the detailed view by default with timestamp-styled lines', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    expect(host.textContent).toContain('课程概览')
    expect(host.textContent).toContain('01:05 引入')
    const tsLines = host.querySelectorAll('p.ts')
    expect(tsLines.length).toBeGreaterThan(0)
  })

  it('switches views when a tab is clicked', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    const tabs = host.querySelectorAll('.note-tabs button')
    expect(tabs[0]!.textContent).toBe('详细笔记')
    const keyPoints = Array.from(tabs).find((b) => b.textContent === '要点') ?? null
    click(keyPoints)
    expect(keyPoints?.classList.contains('active')).toBe(true)
    expect(host.textContent).toContain('【考点】必考：复杂度计算')
  })

  it('renders all four view tabs', () => {
    const host = mount(<NoteViewer note={NOTE} />)
    const labels = Array.from(host.querySelectorAll('.note-tabs button')).map((b) => b.textContent)
    expect(labels).toEqual(['详细笔记', '标准总结', '要点', '方法论'])
  })
})
