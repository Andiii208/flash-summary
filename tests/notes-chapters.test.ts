import { describe, expect, it } from 'vitest'
import { groupTimelineByChapters } from '../src/shared/notes/chapters'
import { parseNote } from '../src/main/notes/schema'
import type { Chapter, TimelineEntry } from '../src/shared/notes/schema'

const entry = (at: number, title = `t${at}`): TimelineEntry => ({ at, title, detail: 'd', refs: [], evidence: [] })
const chapter = (at: number, title: string): Chapter => ({ at, title, summary: 's' })

describe('groupTimelineByChapters（B1, plan 2026-09-19）', () => {
  it('无章节 → 单一未分组桶（旧笔记渲染逐字不变）', () => {
    const entries = [entry(0), entry(100), entry(900)]
    expect(groupTimelineByChapters(entries, [])).toEqual([{ chapter: null, entries }])
  })

  it('按 at 归章：区间 [章K.at, 章K+1.at) 归章 K', () => {
    const chapters = [chapter(600, '乙'), chapter(0, '甲')] // 乱序输入
    const groups = groupTimelineByChapters([entry(50), entry(650), entry(1200)], chapters)
    expect(groups.map((g) => g.chapter?.title)).toEqual(['甲', '乙'])
    expect(groups[0]?.entries.map((e) => e.at)).toEqual([50])
    expect(groups[1]?.entries.map((e) => e.at)).toEqual([650, 1200])
  })

  it('首章之前的条目进未分组桶且排在最前', () => {
    const groups = groupTimelineByChapters([entry(10), entry(500)], [chapter(300, '唯一章')])
    expect(groups[0]?.chapter).toBeNull()
    expect(groups[0]?.entries.map((e) => e.at)).toEqual([10])
    expect(groups[1]?.chapter?.title).toBe('唯一章')
    expect(groups[1]?.entries.map((e) => e.at)).toEqual([500])
  })

  it('空章不进阅读视图（空 section 纪律）', () => {
    const groups = groupTimelineByChapters([entry(50)], [chapter(0, '有内容'), chapter(900, '空章')])
    expect(groups.map((g) => g.chapter?.title)).toEqual(['有内容'])
  })

  it('章内条目保持原时间序', () => {
    const entries = [entry(900), entry(100), entry(850)]
    const groups = groupTimelineByChapters(entries, [chapter(0, '全')])
    expect(groups[0]?.entries).toEqual(entries)
  })

  it('schema：chapters 默认 []（存量笔记零迁移）', () => {
    const note = parseNote(JSON.stringify({ overview: 'o', knowledgeTree: { title: 'r', children: [] }, methodology: 'm' }))
    expect(note.chapters).toEqual([])
  })

  it('schema：at 接受 "mm:ss" 与数字串（与 timeline 同 coercer）', () => {
    const note = parseNote(
      JSON.stringify({
        overview: 'o',
        knowledgeTree: { title: 'r', children: [] },
        methodology: 'm',
        chapters: [
          { at: '10:30', title: '甲', summary: 's' },
          { at: '3600', title: '乙', summary: 's' }
        ]
      })
    )
    expect(note.chapters.map((c) => c.at)).toEqual([630, 3600])
  })
})
