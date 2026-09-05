import { describe, expect, it } from 'vitest'
import { render } from 'preact'
import { PrintHandout } from '../../src/renderer/components/PrintHandout'
import type { Note } from '../../src/shared/notes/schema'
import type { AttachmentLike } from '../../src/shared/notes/evidence'

const NOTE: Note = {
  overview: '本讲介绍复杂度分析。',
  knowledgeTree: { title: '复杂度', children: [{ title: 'O(n)', children: [] }] },
  timeline: [
    { at: 65, title: '引入', detail: '开始讲解', refs: [{ at: 60, text: '今天讲复杂度' }], evidence: [] },
    { at: 300, title: '示例', detail: '举例说明', refs: [], evidence: [{ kind: 'keyframe', ref: 'kf:kf-1' }] }
  ],
  concepts: [{ term: '大O', definition: '渐进上界', refs: [] }],
  formulasAndSteps: [
    { kind: 'formula', content: 'O(f(n))', explanation: '上界记号', refs: [] },
    { kind: 'code', content: 'print("hi")', explanation: '', refs: [] }
  ],
  methodology: '先定义后举例。',
  examCues: ['必考：复杂度计算'],
  questionsAndGaps: ['递归复杂度如何分析？'],
  quiz: [],
  conceptLinks: [],
  transcriptRefs: [],
  evidence: []
}

const ATTACHMENTS: AttachmentLike[] = [{ ref: 'kf:kf-1', kind: 'keyframe', at: 300, dataUrl: 'data:image/jpeg;base64,Zm9v' }]

function mountHandout(): HTMLElement {
  const host = document.createElement('div')
  render(
    <PrintHandout
      note={NOTE}
      attachments={ATTACHMENTS}
      courseName="Python语言设计 4"
      lessonTitle="第9节课"
      teacher="高旺"
      courTimes="周一 第3-4节"
      classroom="东南-205"
      generatedAt="2026/9/4 12:00:00"
    />,
    host
  )
  return host
}

describe('PrintHandout (PDF 讲义, 2026-09-04)', () => {
  it('renders the cover with lesson title, course meta, and generation time', () => {
    const host = mountHandout()
    const text = host.textContent ?? ''
    expect(host.querySelector('.ph-cover h1')?.textContent).toBe('第9节课')
    expect(text).toContain('SEU SUMMARY · 课堂讲义')
    expect(text).toContain('Python语言设计 4')
    expect(text).toContain('高旺')
    expect(text).toContain('2026/9/4')
  })

  it('renders a full-page static mind map (all nodes, no interaction)', () => {
    const host = mountHandout()
    const page = host.querySelector('.ph-mindmap-page')
    expect(page).not.toBeNull()
    const svg = page?.querySelector('svg')
    expect(svg?.querySelectorAll('g')).toHaveLength(2)
    expect(host.querySelector('.ph-mindmap-page svg')).not.toBeNull()
  })

  it('timeline cards carry stamps, quotes, and bound images', () => {
    const host = mountHandout()
    const cards = host.querySelectorAll('.ph-timeline-card')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.querySelector('.ph-timeline-stamp')?.textContent).toBe('01:05')
    expect(cards[0]!.textContent).toContain('今天讲复杂度')
    const img = cards[1]!.querySelector('.ph-timeline-images img')
    expect(img?.getAttribute('src')).toBe('data:image/jpeg;base64,Zm9v')
  })

  it('concepts, formulas (code fence), callouts, and gallery sections render', () => {
    const host = mountHandout()
    expect(host.querySelectorAll('.ph-concept')).toHaveLength(1)
    expect(host.querySelector('.ph-formula.kind-code pre code')?.textContent).toBe('print("hi")')
    expect(host.querySelectorAll('.ph-callout.exam')).toHaveLength(1)
    expect(host.querySelectorAll('.ph-callout.gap')).toHaveLength(1)
    const gallery = host.querySelector('.ph-gallery')
    expect(gallery?.querySelectorAll('figure')).toHaveLength(1)
  })

  it('quiz rows render question|answer side by side and omit when empty (roadmap 2.1)', () => {
    const host = document.createElement('div')
    const quizNote: Note = {
      ...NOTE,
      quiz: [
        { question: '什么是大O？', answer: '渐进上界', source: 'concept', term: '大O' },
        { question: '递归复杂度怎么考？', answer: '主定理展开', source: 'examCue' }
      ]
    }
    render(
      <PrintHandout note={quizNote} attachments={[]} courseName="c" lessonTitle="l" generatedAt="t" />,
      host
    )
    const rows = host.querySelectorAll('.ph-quiz-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.querySelector('.ph-quiz-question')?.textContent).toBe('什么是大O？')
    expect(rows[0]!.querySelector('.ph-quiz-tag')?.textContent).toBe('概念 · 大O')
    expect(rows[0]!.querySelector('.ph-quiz-a')?.textContent).toBe('渐进上界')
    expect(rows[1]!.querySelector('.ph-quiz-tag')?.textContent).toBe('考点')
    const bare = document.createElement('div')
    render(<PrintHandout note={NOTE} attachments={[]} courseName="c" lessonTitle="l" generatedAt="t" />, bare)
    expect((bare.textContent ?? '')).not.toContain('自测题')
  })

  it('empty optional sections are omitted entirely', () => {
    const host = document.createElement('div')
    const bare: Note = {
      ...NOTE,
      concepts: [],
      formulasAndSteps: [],
      examCues: [],
      questionsAndGaps: [],
      timeline: []
    }
    render(
      <PrintHandout note={bare} attachments={[]} courseName="c" lessonTitle="l" generatedAt="t" />,
      host
    )
    const text = host.textContent ?? ''
    expect(text).not.toContain('概念与定义')
    expect(text).not.toContain('考试与作业提示')
    expect(host.querySelector('.ph-gallery figure')).toBeNull()
    // The gallery section itself keeps its placeholder-free heading.
    expect(text).toContain('课堂画面')
  })
})

describe('PrintHandout concept-term sub-lines (M2.1, 2026-09-05)', () => {
  it('prints anchored terms as a muted sub-line inside mindmap nodes', () => {
    const host = document.createElement('div')
    render(
      <PrintHandout
        note={{ ...NOTE, knowledgeTree: { title: '复杂度', terms: ['大O'], children: [{ title: 'O(n)', children: [] }] } }}
        attachments={ATTACHMENTS}
        courseName="课程"
        lessonTitle="第1节课"
        generatedAt="2026/9/5 12:00:00"
      />,
      host
    )
    const texts = Array.from(host.querySelectorAll('.ph-mindmap-page svg text')).map((t) => t.textContent ?? '')
    expect(texts.some((t) => t.includes('大O'))).toBe(true)
  })

  it('nodes without terms print exactly as before (no empty sub-line)', () => {
    const host = mountHandout()
    const texts = Array.from(host.querySelectorAll('.ph-mindmap-page svg text'))
    expect(texts.every((t) => (t.textContent ?? '').trim() !== '')).toBe(true)
    expect(texts.some((t) => (t.textContent ?? '').includes('大O'))).toBe(false)
  })
})

describe('PrintHandout cross-links (M3.1, 2026-09-05)', () => {
  it('prints dashed cross-links and labels on the handout map', () => {
    const host = document.createElement('div')
    render(
      <PrintHandout
        note={{ ...NOTE, conceptLinks: [{ from: 'O(n)', to: '复杂度', label: '前提' }] }}
        attachments={ATTACHMENTS}
        courseName="课程"
        lessonTitle="第1节课"
        generatedAt="2026/9/5 12:00:00"
      />,
      host
    )
    const texts = Array.from(host.querySelectorAll('.ph-mindmap-page svg text')).map((t) => t.textContent ?? '')
    expect(texts.some((t) => t.includes('前提'))).toBe(true)
  })
})
