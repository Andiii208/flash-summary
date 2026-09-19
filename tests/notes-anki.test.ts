import { describe, expect, it } from 'vitest'
import { ankiDecks, deckToTsv } from '../src/shared/notes/anki'
import { parseNote } from '../src/shared/notes/schema'

const base = {
  overview: '概览',
  knowledgeTree: { title: 'root', children: [] },
  methodology: '方法'
}

function noteWith(concepts: Array<{ term: string; definition: string }>, quiz: Array<{ question: string; answer: string; source: 'concept' | 'examCue'; term?: string }>) {
  return parseNote(JSON.stringify({ ...base, concepts, quiz })) as Parameters<typeof ankiDecks>[0]
}

describe('ankiDecks (roadmap 2.2, 2026-09-04)', () => {
  it('builds concept rows as term → definition with the lesson source column', () => {
    const decks = ankiDecks(
      noteWith([{ term: '大O', definition: '渐进上界' }], []),
      '第五讲 极限'
    )
    expect(decks).toHaveLength(1)
    expect(decks[0]?.name).toBe('Anki-概念卡')
    expect(decks[0]?.rows).toEqual(['大O\t渐进上界\t第五讲 极限'])
  })

  it('builds quiz rows as question → answer', () => {
    const decks = ankiDecks(
      noteWith([], [{ question: '什么是大O？', answer: '渐进上界', source: 'concept', term: '大O' }]),
      '第五讲 极限'
    )
    expect(decks).toHaveLength(1)
    expect(decks[0]?.name).toBe('Anki-自测题')
    expect(decks[0]?.rows).toEqual(['什么是大O？\t渐进上界\t第五讲 极限'])
  })

  it('collapses tabs and newlines inside fields so rows never break', () => {
    const decks = ankiDecks(
      noteWith([{ term: 'A\tB', definition: '第一行\n第二行' }], []),
      '课\t时'
    )
    expect(decks[0]?.rows).toEqual(['A B\t第一行 第二行\t课 时'])
  })

  it('skips empty decks entirely and keeps both when both have data', () => {
    expect(ankiDecks(noteWith([], []), 't')).toEqual([])
    const both = ankiDecks(
      noteWith([{ term: 't', definition: 'd' }], [{ question: 'q', answer: 'a', source: 'examCue' }]),
      't'
    )
    expect(both.map((d) => d.name)).toEqual(['Anki-概念卡', 'Anki-自测题'])
  })

  it('deckToTsv terminates every file with a newline', () => {
    const decks = ankiDecks(noteWith([{ term: 't', definition: 'd' }], []), '课')
    expect(deckToTsv(decks[0]!)).toBe('t\td\t课\n')
  })

  it('批2: 公式注入中和——以 = + - @ 开头的单元格前置单引号，导入时按纯文本处理', () => {
    // Anki/Excel 会把这类单元格当公式执行（CSV 注入），前置 ' 后按文本导入。
    const decks = ankiDecks(
      noteWith(
        [{ term: '=1+1', definition: '+SUM(A1)' }, { term: '-2', definition: '@risk' }, { term: 'ok', definition: '普通文本' }],
        [{ question: '=cmd', answer: '-1', source: 'examCue' }]
      ),
      '课'
    )
    expect(decks[0]?.rows).toEqual(["'=1+1\t'+SUM(A1)\t课", "'-2\t'@risk\t课", 'ok\t普通文本\t课'])
    expect(decks[1]?.rows).toEqual(["'=cmd\t'-1\t课"])
  })
})
