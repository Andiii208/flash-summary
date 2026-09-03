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
})
