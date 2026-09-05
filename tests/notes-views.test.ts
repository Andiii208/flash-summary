import { describe, expect, it } from 'vitest'
import { NoteSchema, parseNote } from '../src/main/notes/schema'
import { projectNote, projectNoteBlocks, VIEW_IDS, looksLikeMarkdown } from '../src/main/notes/views'
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
  quiz: [],
  conceptLinks: [],
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

describe('views from the same JSON', () => {
  it('exposes the five reading views (2026-09-04: + mindmap)', () => {
    expect(VIEW_IDS).toEqual(['detailed', 'standard', 'key_points', 'methodology', 'mindmap'])
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

  it('all reading views derive from one JSON without independent generation', () => {
    const json = JSON.stringify(sampleNote)
    const parsed = parseNote(json)
    // Flat projections keep four non-empty views; mindmap renders via blocks.
    for (const view of VIEW_IDS.filter((v) => v !== 'mindmap')) {
      expect(projectNote(parsed, view).length).toBeGreaterThan(0)
    }
    for (const view of VIEW_IDS) {
      expect(projectNoteBlocks(parsed, view).length).toBeGreaterThan(0)
    }
  })
})

describe('projectNoteBlocks structured projections (2026-09-04)', () => {
  it('detailed view maps every section to typed blocks', () => {
    const sections = projectNoteBlocks(sampleNote, 'detailed')
    const headings = sections.map((s) => s.heading)
    expect(headings).toEqual(['课程概览', '知识结构', '时间线', '概念与定义', '公式、代码与操作步骤', '考试与作业提示', '疑问与缺口'])
    expect(sections[1].blocks[0]).toEqual({ block: 'tree', node: sampleNote.knowledgeTree })
    expect(sections[2].blocks[0]?.block).toBe('timeline')
    expect(sections[3].blocks[0]?.block).toBe('concepts')
    expect(sections[4].blocks[0]?.block).toBe('formulas')
    expect(sections[5].blocks[0]).toMatchObject({ block: 'callout', tone: 'exam' })
    expect(sections[6].blocks[0]).toMatchObject({ block: 'callout', tone: 'gap' })
  })

  it('empty sections are omitted instead of rendering headers with nothing', () => {
    const minimal = parseNote(
      JSON.stringify({ overview: '一句话', knowledgeTree: { title: 'r', children: [] }, methodology: 'm', examCues: [], questionsAndGaps: [] })
    )
    const sections = projectNoteBlocks(minimal, 'detailed')
    expect(sections.map((s) => s.heading)).toEqual(['课程概览', '知识结构'])
  })

  it('plain-text overview projects as paragraph, markdown-ish as markdown block', () => {
    const plain = projectNoteBlocks(sampleNote, 'detailed')[0].blocks[0]
    expect(plain).toEqual({ block: 'paragraph', text: sampleNote.overview })
    const mdNote = parseNote(JSON.stringify({ ...sampleNote, overview: '总起。\n\n## 主线\n- A' }))
    expect(projectNoteBlocks(mdNote, 'detailed')[0].blocks[0]?.block).toBe('markdown')
  })

  it('mindmap view carries the tree plus overview', () => {
    const sections = projectNoteBlocks(sampleNote, 'mindmap')
    expect(sections[0]).toEqual({ heading: '知识导图', blocks: [{ block: 'tree', node: sampleNote.knowledgeTree }] })
    expect(sections[1].blocks[0]?.block).toBe('paragraph')
  })

  it('methodology view steps exclude formulas and carry explanations', () => {
    const sections = projectNoteBlocks(sampleNote, 'methodology')
    const steps = sections[1].blocks[0]
    expect(steps).toMatchObject({
      block: 'steps',
      items: [
        { content: 'syms x; limit(sin(x)/x, x, 0)', explanation: 'MATLAB 验证' },
        { content: '先化简再代入', explanation: '' }
      ]
    })
  })

  it('key points view gains a self-quiz section; empty quiz omits it (roadmap 2.1)', () => {
    const quizNote = parseNote(
      JSON.stringify({
        ...sampleNote,
        quiz: [
          { question: '什么是大O？', answer: '渐进上界', source: 'concept', term: '大O' },
          { question: '递归复杂度怎么考？', answer: '主定理展开', source: 'examCue' }
        ]
      })
    )
    const sections = projectNoteBlocks(quizNote, 'key_points')
    expect(sections.map((s) => s.heading)).toEqual(['要点', '自测题'])
    expect(sections[1].blocks[0]).toEqual({
      block: 'quiz',
      items: [
        { question: '什么是大O？', answer: '渐进上界', source: 'concept', term: '大O' },
        { question: '递归复杂度怎么考？', answer: '主定理展开', source: 'examCue' }
      ]
    })
    // No quiz → the whole section disappears (empty-section discipline).
    const bare = projectNoteBlocks(sampleNote, 'key_points')
    expect(bare.map((s) => s.heading)).toEqual(['要点'])
  })
})

describe('looksLikeMarkdown', () => {
  it('detects headings, lists, and bold; rejects plain prose', () => {
    expect(looksLikeMarkdown('## 小节')).toBe(true)
    expect(looksLikeMarkdown('- 项目')).toBe(true)
    expect(looksLikeMarkdown('**加粗**')).toBe(true)
    expect(looksLikeMarkdown('1. 步骤')).toBe(true)
    expect(looksLikeMarkdown('这就是一句普通的中文句子。')).toBe(false)
  })
})
