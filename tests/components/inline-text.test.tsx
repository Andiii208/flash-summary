import { describe, expect, it } from 'vitest'
import { render } from 'preact'
import { InlineText } from '../../src/renderer/components/InlineText'
import { PrintHandout } from '../../src/renderer/components/PrintHandout'
import type { Note } from '../../src/shared/notes/schema'

describe('InlineText (批4: 单字段内联 markdown)', () => {
  it('renders **bold** and `code` as elements — no literal asterisks', () => {
    const host = document.createElement('div')
    render(<InlineText text="先 **前向传播** 再 `ReLU`" />, host)
    expect(host.querySelector('strong')?.textContent).toBe('前向传播')
    expect(host.querySelector('code')?.textContent).toBe('ReLU')
    expect(host.textContent).not.toContain('**')
    expect(host.textContent).not.toContain('`')
  })

  it('plain text passes through untouched', () => {
    const host = document.createElement('div')
    render(<InlineText text="纯文本 1. 编号保留" />, host)
    expect(host.textContent).toBe('纯文本 1. 编号保留')
  })
})

describe('PrintHandout 批4 (九类字段不再印出字面 **)', () => {
  const MARKDOWN_NOTE: Note = {
    overview: '概览。',
    knowledgeTree: { title: '树', children: [] },
    timeline: [{ at: 60, title: '引入', detail: '**反向传播** 的链式法则', refs: [], evidence: [] }],
    concepts: [{ term: '链式法则', definition: '即 `dL/dx` 的复合求导', refs: [] }],
    formulasAndSteps: [
      { kind: 'operation', content: '1. **前向传播**：按拓扑序计算\n2. **反向传播**：逆序访问', explanation: '这是 `反向传播` 的核心', refs: [] }
    ],
    methodology: '方法论。',
    examCues: ['必考：**链式法则** 推导'],
    questionsAndGaps: ['`自动微分` 与手写推导的对应'],
    quiz: [{ question: '什么是 **梯度**？', answer: '即 `dL/dθ`', source: 'examCue' }],
    conceptLinks: [],
    transcriptRefs: [],
    evidence: []
  }

  function mountHandout(note: Note): HTMLElement {
    const host = document.createElement('div')
    render(<PrintHandout note={note} attachments={[]} courseName="课程" lessonTitle="第1节课" generatedAt="t" />, host)
    return host
  }

  it('no field prints a literal ** — bold renders as <strong>', () => {
    const host = mountHandout(MARKDOWN_NOTE)
    expect(host.textContent).not.toContain('**')
    expect(host.querySelectorAll('strong').length).toBeGreaterThanOrEqual(4)
  })

  it('operation multi-step content renders as an ordered list, not one long line', () => {
    const host = mountHandout(MARKDOWN_NOTE)
    const items = host.querySelectorAll('.ph-formula .md-lite ol li')
    expect(items.length).toBe(2)
  })

  it('bare `code` spans render as <code> in non-markdown fields', () => {
    const host = mountHandout(MARKDOWN_NOTE)
    expect(host.querySelectorAll('code').length).toBeGreaterThanOrEqual(3)
    expect(host.textContent).not.toContain('`')
  })
})
