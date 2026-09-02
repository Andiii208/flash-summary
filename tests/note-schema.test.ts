import { describe, expect, it } from 'vitest'
import { parseNote } from '../src/shared/notes/schema'

const base = {
  overview: '概览',
  knowledgeTree: { title: 'root', children: [] },
  methodology: '方法'
}

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
})

describe('parseNote repair pass', () => {
  it('repairs trailing commas, fences, and prose around the object', () => {
    const raw = '说明如下\n```json\n{ "overview": "概览", "knowledgeTree": { "title": "r", "children": [], }, "methodology": "m", }\n```\n以上'
    const note = parseNote(raw)
    expect(note.overview).toBe('概览')
  })
})
