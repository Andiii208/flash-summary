import { describe, expect, it } from 'vitest'
import { noteToMarkdown } from '../src/shared/notes/markdown'
import { parseNote } from '../src/main/notes/schema'
import { readFileSync } from 'fs'
import { join } from 'path'

const json = readFileSync(join(__dirname, 'fixtures', 'sample-note.json'), 'utf8')

describe('noteToMarkdown export', () => {
  it('renders overview, tree, timeline, concepts, methodology', () => {
    const note = parseNote(json)
    const md = noteToMarkdown(note, '第五讲 极限')
    expect(md).toContain('# 第五讲 极限')
    expect(md).toContain('本讲介绍极限')
    expect(md).toContain('- 极限')
    expect(md).toContain('  - 定义')
    expect(md).toContain('## 方法论')
  })

  it('structured format: bold timeline stamps, quoted refs, evidence lines, code fences (2026-09-04)', () => {
    const note = parseNote(json)
    const md = noteToMarkdown(note, '第五讲 极限')
    expect(md).toContain('## 时间线')
    expect(md).toContain('- **00:00 · 开场**：回顾上讲内容')
    expect(md).toContain('## 考试与作业提示')
    expect(md).toContain('- ε-δ 语言证明题几乎每年必考')
    expect(md).not.toContain('## 疑问与缺口')
  })

  it('code formulas render as fenced blocks and keyframe evidence is labelled', () => {
    const note = parseNote(json)
    note.formulasAndSteps = [
      { kind: 'code', content: 'print("hi")', explanation: '演示', refs: [] },
      { kind: 'operation', content: '三步走', explanation: '', refs: [] }
    ]
    note.timeline[0].evidence = [{ kind: 'keyframe', ref: 'kf:1690625-L0-kf-3' }]
    const md = noteToMarkdown(note, 't')
    expect(md).toContain('## 公式、代码与操作步骤')
    expect(md).toContain('```')
    expect(md).toContain('print("hi")')
    expect(md).toContain('- **操作**：三步走')
    expect(md).toContain('- 证据：关键帧 1690625-L0-kf-3')
  })

  it('quiz section exports numbered Q/A with anchors; omitted when empty (roadmap 2.1)', () => {
    const note = parseNote(json)
    note.quiz = [
      { question: '什么是大O？', answer: '渐进上界', source: 'concept', term: '大O' },
      { question: '递归复杂度怎么考？', answer: '主定理展开', source: 'examCue' }
    ]
    const md = noteToMarkdown(note, 't')
    expect(md).toContain('## 自测题')
    expect(md).toContain('1. **Q**：什么是大O？')
    expect(md).toContain('   - **A**：渐进上界')
    expect(md).toContain('   - 锚点：概念：大O')
    expect(md).toContain('2. **Q**：递归复杂度怎么考？')
    expect(md).toContain('   - 锚点：考点')
    const bare = noteToMarkdown(parseNote(json), 't')
    expect(bare).not.toContain('## 自测题')
  })
})

describe('outline concept annotations (M2.1, 2026-09-05)', () => {
  it('appends anchored concept terms to tree outline lines', () => {
    const note = parseNote(
      JSON.stringify({
        overview: '概览',
        knowledgeTree: {
          title: 'root',
          terms: ['大O'],
          children: [{ title: 'child', children: [], terms: ['递归', '大O'] }]
        },
        concepts: [
          { term: '大O', definition: '渐进上界', refs: [] },
          { term: '递归', definition: '自调用', refs: [] }
        ],
        methodology: '方法'
      })
    )
    const md = noteToMarkdown(note, '标题')
    expect(md).toContain('- root（概念：大O）')
    expect(md).toContain('  - child（概念：递归、大O）')
  })

  it('outline lines stay plain when nodes carry no terms', () => {
    const note = parseNote(json)
    expect(noteToMarkdown(note, '第五讲 极限')).toContain('  - 定义\n')
  })
})
