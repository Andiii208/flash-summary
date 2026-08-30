import { describe, expect, it } from 'vitest'
import { NoteSchema, parseNote } from '../src/main/notes/schema'
import { projectNote, VIEW_IDS } from '../src/main/notes/views'
import type { Note } from '../src/main/notes/schema'

const sampleNote: Note = {
  overview: '本讲介绍极限的定义与计算方法。',
  knowledgeTree: {
    title: '极限',
    children: [
      { title: '定义', children: [{ title: 'ε-δ 定义', children: [] }] },
      { title: '计算', children: [{ title: '洛必达法则', children: [] }, { title: '等价无穷小', children: [] }] }
    ]
  },
  timeline: [
    { at: 0, title: '开场', detail: '回顾上讲内容', refs: [{ at: 5, text: '上节课我们讲到' }], evidence: [] },
    { at: 600, title: 'ε-δ 定义', detail: '严格定义引入', refs: [], evidence: [{ kind: 'ppt', ref: '3' }] }
  ],
  concepts: [
    { term: '极限', definition: '当 x 趋于 a 时 f(x) 无限接近 L', refs: [] }
  ],
  formulasAndSteps: [
    { kind: 'formula', content: 'lim(x→a) f(x) = L', explanation: '标准记号', refs: [] },
    { kind: 'code', content: 'syms x; limit(sin(x)/x, x, 0)', explanation: 'MATLAB 验证', refs: [] },
    { kind: 'operation', content: '先化简再代入', explanation: '', refs: [] }
  ],
  methodology: '先从直观出发，再引入严格定义，最后用法则计算。',
  examCues: ['ε-δ 语言证明题几乎每年必考'],
  questionsAndGaps: ['一致收敛与逐点收敛的区别尚未讲清'],
  transcriptRefs: [{ at: 5, text: '上节课我们讲到' }],
  evidence: [{ kind: 'ppt', ref: '3' }]
}

describe('note schema', () => {
  it('validates a complete note', () => {
    expect(() => NoteSchema.parse(sampleNote)).not.toThrow()
  })

  it('rejects notes missing overview', () => {
    expect(() => parseNote(JSON.stringify({ ...sampleNote, overview: undefined }))).toThrowError(/overview|validation/)
  })

  it('defaults timeline/concepts to empty arrays when omitted', () => {
    const minimal = parseNote(
      JSON.stringify({
        overview: '概览',
        knowledgeTree: { title: 'root', children: [] },
        methodology: '方法',
        examCues: [],
        questionsAndGaps: []
      })
    )
    expect(minimal.timeline).toEqual([])
    expect(minimal.concepts).toEqual([])
  })
})

describe('four views from the same JSON', () => {
  it('exposes exactly the four spec views', () => {
    expect(VIEW_IDS).toEqual(['detailed', 'standard', 'key_points', 'methodology'])
  })

  it('detailed view contains all sections', () => {
    const sections = projectNote(sampleNote, 'detailed')
    const headings = sections.map((s) => s.heading)
    expect(headings).toEqual([
      '课程概览', '知识结构', '时间线', '概念与定义', '公式、代码与操作步骤', '考试与作业提示', '疑问与缺口', '证据引用'
    ])
    expect(sections[2].lines[1]).toContain('10:00')
    expect(sections[4].lines.join('\n')).toContain('lim(x→a)')
  })

  it('standard view is a strict subset (overview + tree + top concepts)', () => {
    const sections = projectNote(sampleNote, 'standard')
    expect(sections.map((s) => s.heading)).toEqual(['课程概览', '知识结构', '重点概念'])
    expect(sections[0].lines).toEqual([sampleNote.overview])
  })

  it('key points view surfaces exam cues and gaps', () => {
    const sections = projectNote(sampleNote, 'key_points')
    const lines = sections.flatMap((s) => s.lines)
    expect(lines.some((l) => l.includes('【考点】'))).toBe(true)
    expect(lines.some((l) => l.includes('【待解决】'))).toBe(true)
  })

  it('methodology view centers on the methodology field', () => {
    const sections = projectNote(sampleNote, 'methodology')
    expect(sections[0].lines).toEqual([sampleNote.methodology])
    // Only operation/code steps, not formulas.
    expect(sections[1].lines).not.toContain('lim(x→a) f(x) = L')
    expect(sections[1].lines).toContain('先化简再代入')
  })

  it('all four views derive from one JSON without independent generation', () => {
    const json = JSON.stringify(sampleNote)
    const parsed = parseNote(json)
    for (const view of VIEW_IDS) {
      expect(projectNote(parsed, view).length).toBeGreaterThan(0)
    }
  })
})
