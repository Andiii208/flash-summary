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
})
