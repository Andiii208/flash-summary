import { describe, expect, it } from 'vitest'
import { NoteSchema, parseNote } from '../src/main/notes/schema'
import { projectNote, projectNoteBlocks, VIEW_IDS, looksLikeMarkdown } from '../src/main/notes/views'
import type { Note } from '../src/main/notes/schema'

const sampleNote: Note = {
  chapters: [],
  quotes: [],
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

  // 2026-09-20 实锤回归：app-shell 夹具直接喂未过归一层的原始 note（缺 chapters/quotes），
  // detailedBlocks 直取 note.chapters.length 会抛 TypeError 崩掉整个渲染。
  // 纪律同 markdown/obsidian/health：投影层容忍部分形状，宁退化为旧行为也不抛。
  it('detailed blocks tolerate a note missing chapters/quotes (partial shape)', () => {
    const partial = JSON.parse(JSON.stringify(sampleNote)) as Record<string, unknown>
    delete partial.chapters
    delete partial.quotes
    const blocks = projectNoteBlocks(partial as unknown as Note, 'detailed')
    const timeline = blocks.find((s) => s.heading === '时间线')?.blocks[0]
    expect('chapters' in (timeline ?? {})).toBe(false)
    expect(blocks.some((s) => s.heading === '金句')).toBe(false)
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

  it('批4: 认出「只有表格」的文本（此前会落进纯段落分支，把竖线原样印出来）', () => {
    const tableOnly = '| 组件 | 许可 |\n|---|---|\n| zod | MIT |'
    expect(looksLikeMarkdown(tableOnly)).toBe(true)
    // 含竖线但不是表格（下一行不是分隔行）仍算普通文本。
    expect(looksLikeMarkdown('条件 a | 条件 b')).toBe(false)
  })

  it('批4: 公式不改变分块判据，但带公式的列表照样触发 markdown 分支', () => {
    expect(looksLikeMarkdown('- 公式：$L = -\\sum y\\log p$')).toBe(true)
  })
})

describe('B3 tldr（plan 2026-09-19-note-experience-overhaul）', () => {
  it('有 tldr → 详细/标准视图的「课程概览」第一个块是它', () => {
    const note: Note = { ...sampleNote, tldr: '极限讲的是变化率的严格化：定义、计算与常见法则。' }
    for (const view of ['detailed', 'standard'] as const) {
      const sections = projectNoteBlocks(note, view)
      const overview = sections.find((s) => s.heading === '课程概览')
      expect(overview?.blocks[0]).toEqual({ block: 'paragraph', text: '极限讲的是变化率的严格化：定义、计算与常见法则。' })
    }
  })

  it('无 tldr → 第一个块仍是概览（旧笔记渲染逐字节不变）', () => {
    const sections = projectNoteBlocks(sampleNote, 'detailed')
    const overview = sections.find((s) => s.heading === '课程概览')
    expect(overview?.blocks).toHaveLength(1)
    // 纯散文 overview 投影为 paragraph 块；无 tldr 时全屉刚好这一块。
    expect(overview?.blocks).toEqual([{ block: 'paragraph', text: sampleNote.overview }])
  })

  it('空串 tldr 视同没有', () => {
    const note: Note = { ...sampleNote, tldr: '   ' }
    const sections = projectNoteBlocks(note, 'standard')
    expect(sections.find((s) => s.heading === '课程概览')?.blocks).toHaveLength(1)
  })
})

describe('B1 timeline 块携带 chapters（plan 2026-09-19）', () => {
  it('有章节 → timeline 块带 chapters；无章节 → 不带（旧笔记逐字节不变）', () => {
    const withChapters: Note = { ...sampleNote, chapters: [{ at: 300, title: '乙章', summary: 's' }] }
    const block = projectNoteBlocks(withChapters, 'detailed').find((s) => s.heading === '时间线')?.blocks[0]
    expect(block?.block).toBe('timeline')
    expect(block && 'chapters' in block ? block.chapters : undefined).toEqual([{ at: 300, title: '乙章', summary: 's' }])
    const plain = projectNoteBlocks(sampleNote, 'detailed').find((s) => s.heading === '时间线')?.blocks[0]
    expect(plain && 'chapters' in plain ? plain.chapters : undefined).toBeUndefined()
  })
})

describe('B2 金句节（plan 2026-09-19）', () => {
  it('有 quotes → 详细视图在概念前插「金句」节；无则不出现', () => {
    const withQuotes: Note = { ...sampleNote, quotes: [{ at: 300, text: '极限是一种态度' }] }
    const sections = projectNoteBlocks(withQuotes, 'detailed')
    const headings = sections.map((s) => s.heading)
    expect(headings).toContain('金句')
    expect(headings.indexOf('金句')).toBeLessThan(headings.indexOf('概念与定义'))
    const block = sections.find((s) => s.heading === '金句')?.blocks[0]
    expect(block).toEqual({ block: 'quotes', items: [{ at: 300, text: '极限是一种态度' }] })
    expect(projectNoteBlocks(sampleNote, 'detailed').map((s) => s.heading)).not.toContain('金句')
  })
})
