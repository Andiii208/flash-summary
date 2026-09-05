import { describe, expect, it } from 'vitest'
import { parseNote } from '../src/shared/notes/schema'

const base = {
  overview: '概览',
  knowledgeTree: { title: 'root', children: [] },
  methodology: '方法'
}

describe('parseNote quiz normalization (roadmap 2.1, 2026-09-04)', () => {
  it('defaults to an empty array for old notes without quiz', () => {
    const note = parseNote(JSON.stringify(base))
    expect(note.quiz).toEqual([])
  })

  it('keeps anchored items with concept/examCue sources', () => {
    const note = parseNote(
      JSON.stringify({
        ...base,
        quiz: [
          { question: '什么是大O？', answer: '渐进上界。', source: 'concept', term: '大O' },
          { question: '复杂度必考哪类题？', answer: '递归树展开。', source: 'examCue' }
        ]
      })
    )
    expect(note.quiz).toHaveLength(2)
    expect(note.quiz[0]).toEqual({ question: '什么是大O？', answer: '渐进上界。', source: 'concept', term: '大O' })
    expect(note.quiz[1]?.term).toBeUndefined()
  })

  it('drops unanchored or empty items instead of failing the note', () => {
    const note = parseNote(
      JSON.stringify({
        ...base,
        quiz: [
          { question: '无锚题', answer: '有答案', source: 'madeUp' },
          { question: '', answer: '答案', source: 'concept' },
          { question: '有题', answer: '', source: 'concept' },
          { question: '合法题', answer: '答案', source: 'concept', term: '大O' },
          'garbage',
          null
        ]
      })
    )
    expect(note.quiz).toEqual([{ question: '合法题', answer: '答案', source: 'concept', term: '大O' }])
  })
})

describe('parseNote timestamp normalization (field case 2026-09-02)', () => {
  it('accepts numeric-string and mm:ss timeline/transcript timestamps', () => {
    const note = parseNote(
      JSON.stringify({
        ...base,
        timeline: [
          { at: '12:30', title: '开场', detail: 'd' },
          { at: '750', title: '中段', detail: 'd' }
        ],
        transcriptRefs: [{ at: '60', text: '片段' }]
      })
    )
    expect(note.timeline[0].at).toBe(750)
    expect(note.timeline[1].at).toBe(750)
    expect(note.transcriptRefs[0].at).toBe(60)
  })

  it('keeps native numbers untouched and still rejects garbage', () => {
    const note = parseNote(
      JSON.stringify({ ...base, timeline: [{ at: 12, title: 't', detail: 'd' }] })
    )
    expect(note.timeline[0].at).toBe(12)
    expect(() =>
      parseNote(JSON.stringify({ ...base, timeline: [{ at: '第3分钟', title: 't', detail: 'd' }] }))
    ).toThrowError(/at/)
  })

  it('normalizes nested refs timestamps', () => {
    const note = parseNote(
      JSON.stringify({
        ...base,
        timeline: [{ at: 0, title: 't', detail: 'd', refs: [{ at: '1:05', text: 'x' }] }]
      })
    )
    expect(note.timeline[0].refs[0].at).toBe(65)
  })
})

describe('parseNote formula-kind normalization (field case 2026-09-04)', () => {
  it('degrades unknown formulasAndSteps kinds to operation instead of failing', () => {
    const note = parseNote(
      JSON.stringify({
        ...base,
        formulasAndSteps: [
          { kind: 'step', content: '三步走', explanation: '' },
          { kind: 'code', content: 'print("hi")', explanation: '' }
        ]
      })
    )
    expect(note.formulasAndSteps[0]?.kind).toBe('operation')
    expect(note.formulasAndSteps[0]?.content).toBe('三步走')
    expect(note.formulasAndSteps[1]?.kind).toBe('code')
  })

  it('extracts text from object items in string lists (examCues as objects)', () => {
    const note = parseNote(
      JSON.stringify({
        ...base,
        examCues: [
          { title: '递归树展开是必考题', detail: '每年第三大题' },
          '普通字符串考点',
          { unrelated: 1 },
          null
        ],
        questionsAndGaps: [{ question: '一致收敛为何难？' }]
      })
    )
    expect(note.examCues).toEqual(['递归树展开是必考题', '普通字符串考点'])
    expect(note.questionsAndGaps).toEqual(['一致收敛为何难？'])
  })
})

describe('parseNote evidence-kind normalization', () => {
  it('repairs evidence kinds that leak from formulasAndSteps via the ref prefix', () => {
    const note = parseNote(
      JSON.stringify({
        ...base,
        timeline: [{ at: 0, title: 't', detail: 'd', evidence: [{ kind: 'formula', ref: 'ppt:3' }, { kind: 'code', ref: 'kf:k1' }] }],
        evidence: [{ kind: 'operation', ref: 'kf:k2' }]
      })
    )
    expect(note.timeline[0].evidence).toEqual([
      { kind: 'ppt', ref: 'ppt:3' },
      { kind: 'keyframe', ref: 'kf:k1' }
    ])
    expect(note.evidence).toEqual([{ kind: 'keyframe', ref: 'kf:k2' }])
  })

  it('drops fabricated prose refs instead of failing the whole note (对齐修复 2026-09-04)', () => {
    const note = parseNote(
      JSON.stringify({
        ...base,
        timeline: [
          { at: 0, title: 't', detail: 'd', evidence: [{ kind: 'keyframe', ref: '超参数调整演示幻灯片' }, { kind: 'keyframe', ref: 'kf:1690625-L0-kf-12' }] }
        ],
        evidence: [
          { kind: 'ppt', ref: '第3页' },
          { kind: 'ppt', ref: 'ppt:0' }
        ]
      })
    )
    expect(note.timeline[0].evidence).toEqual([{ kind: 'keyframe', ref: 'kf:1690625-L0-kf-12' }])
    expect(note.evidence).toEqual([{ kind: 'ppt', ref: 'ppt:0' }])
  })

  it('still drops non-object evidence entries instead of throwing', () => {
    const note = parseNote(
      JSON.stringify({ ...base, evidence: ['garbage', { kind: 'ppt', ref: 'ppt:1' }] })
    )
    expect(note.evidence).toEqual([{ kind: 'ppt', ref: 'ppt:1' }])
  })
})

describe('parseNote repair pass', () => {
  it('repairs trailing commas, fences, and prose around the object', () => {
    const raw = '说明如下\n```json\n{ "overview": "概览", "knowledgeTree": { "title": "r", "children": [], }, "methodology": "m", }\n```\n以上'
    const note = parseNote(raw)
    expect(note.overview).toBe('概览')
  })
})

describe('parseNote knowledgeTree terms normalization (M2.1, 2026-09-05)', () => {
  const withConcepts = {
    ...base,
    concepts: [{ term: '大O', definition: '渐进上界', refs: [] }, { term: '递归', definition: '自调用', refs: [] }]
  }

  it('keeps terms that resolve to concepts, deduplicated, across the whole tree', () => {
    const note = parseNote(
      JSON.stringify({
        ...withConcepts,
        knowledgeTree: {
          title: 'root',
          terms: ['大O', '不存在的概念', '大O', 42],
          children: [{ title: 'child', terms: ['递归'], children: [] }]
        }
      })
    )
    expect(note.knowledgeTree.terms).toEqual(['大O'])
    expect(note.knowledgeTree.children[0]?.terms).toEqual(['递归'])
  })

  it('drops the field entirely when no term resolves (前向引用容错)', () => {
    const note = parseNote(
      JSON.stringify({
        ...withConcepts,
        knowledgeTree: { title: 'root', terms: ['编造甲', '编造乙'], children: [] }
      })
    )
    expect(note.knowledgeTree.terms).toBeUndefined()
  })

  it('old notes without terms load unchanged', () => {
    const note = parseNote(
      JSON.stringify({ ...base, knowledgeTree: { title: 'root', children: [{ title: 'leaf', children: [] }] } })
    )
    expect(note.knowledgeTree.terms).toBeUndefined()
    expect(note.knowledgeTree.children[0]?.terms).toBeUndefined()
  })
})
