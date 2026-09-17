/**
 * 批2 (plan 2026-09-17 note-quality upgrade) 单测：Concept.example 契约扩展。
 *
 * 「好总结本应含具体例子」——此前 Concept 只有 term/definition/refs，例子只能塞进
 * formulasAndSteps[].explanation 的自由文本。本批加一个可选字段，并同步全部投影。
 *
 * 纪律：新字段**可选**，旧笔记零迁移；宁空勿编（讲者没给例子就省略）。
 */
import { describe, expect, it } from 'vitest'
import { parseNote } from '../src/shared/notes/schema'
import { noteToMarkdown } from '../src/shared/notes/markdown'
import { projectObsidianNote } from '../src/shared/notes/obsidian'
import { ankiDecks, deckToTsv } from '../src/shared/notes/anki'
import { projectNoteBlocks } from '../src/shared/notes/views'

const BASE = {
  overview: '概览内容。'.repeat(50),
  knowledgeTree: { title: '梯度下降', children: [] },
  timeline: [],
  formulasAndSteps: [],
  methodology: '方法论',
  examCues: [],
  questionsAndGaps: [],
  quiz: [],
  conceptLinks: [],
  transcriptRefs: [],
  evidence: []
}

const WITH_EXAMPLE = parseNote(
  JSON.stringify({
    ...BASE,
    concepts: [
      {
        term: '学习率',
        definition: '优化算法中的步长参数，控制每次参数更新的幅度；过大会震荡，过小则收敛极慢。',
        example: '演示里把学习率从 0.1 调到 1.0，损失曲线直接发散。'
      }
    ]
  })
)

const WITHOUT_EXAMPLE = parseNote(
  JSON.stringify({
    ...BASE,
    concepts: [
      { term: '学习率', definition: '优化算法中的步长参数，控制每次参数更新的幅度；过大会震荡，过小则收敛极慢。' }
    ]
  })
)

describe('批2 契约：Concept.example 可选', () => {
  it('带 example 正常解析', () => {
    expect(WITH_EXAMPLE.concepts[0]?.example).toBe('演示里把学习率从 0.1 调到 1.0，损失曲线直接发散。')
  })

  it('旧笔记（无该字段）零迁移加载：example 为 undefined，其余逐字不变', () => {
    expect(WITHOUT_EXAMPLE.concepts[0]?.example).toBeUndefined()
    expect(WITHOUT_EXAMPLE.concepts[0]?.term).toBe('学习率')
    expect(WITHOUT_EXAMPLE.concepts[0]?.refs).toEqual([])
  })
})

describe('批2 投影：example 全链路落地', () => {
  it('markdown 导出：有例子出子行，无例子只出概念行（不留空壳）', () => {
    const withExample = noteToMarkdown(WITH_EXAMPLE, '第 1 讲')
    expect(withExample).toContain('- **学习率**：')
    expect(withExample).toContain('  - 例：演示里把学习率从 0.1 调到 1.0')
    const without = noteToMarkdown(WITHOUT_EXAMPLE, '第 1 讲')
    expect(without).not.toContain('例：')
  })

  it('Obsidian：概念区带例子；SR 卡把例子并进同一行（:: 是单行语法，不能跨行）', () => {
    const meta = { course: '机器学习', lesson: '第 1 讲', generatedAt: '2026-09-17T00:00:00Z', attachments: [] }
    const projection = projectObsidianNote(WITH_EXAMPLE, meta as never)
    expect(projection.markdown).toContain('- 例：演示里把学习率从 0.1 调到 1.0')
    const cardLine = projection.markdown.split('\n').find((line) => line.includes('学习率]]::'))
    expect(cardLine).toBeDefined()
    expect(cardLine).toContain('例：演示里把学习率从 0.1 调到 1.0')
    // 单行语法：:: 之后不得出现换行
    expect(cardLine?.includes('\n')).toBe(false)
  })

  it('Anki（D7=A）：概念卡背面带例子；无例子时背面就是定义', () => {
    const withExample = deckToTsv(ankiDecks(WITH_EXAMPLE, '第 1 讲')[0]!)
    expect(withExample).toContain('学习率\t')
    expect(withExample).toContain('例：演示里把学习率从 0.1 调到 1.0')
    // TSV 字段内不得有制表符/换行（否则整行被撑开）
    expect(withExample.split('\n')[0]?.split('\t')).toHaveLength(3)

    const without = deckToTsv(ankiDecks(WITHOUT_EXAMPLE, '第 1 讲')[0]!)
    expect(without).not.toContain('例：')
  })

  it('块投影：concepts 块原样携带 example 供渲染层使用', () => {
    const blocks = projectNoteBlocks(WITH_EXAMPLE, 'detailed')
    const conceptBlock = blocks.flatMap((section) => section.blocks).find((block) => block.block === 'concepts')
    expect(conceptBlock).toBeDefined()
    const items = (conceptBlock as { items: Array<{ example?: string }> }).items
    expect(items[0]?.example).toContain('0.1 调到 1.0')
  })
})
