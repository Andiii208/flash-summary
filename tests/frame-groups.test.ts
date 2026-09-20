import { describe, expect, it } from 'vitest'
import { groupFramesByChapters } from '../src/shared/notes/frame-groups'

const chapter = (at: number, title: string) => ({ at, title, summary: 's' })

describe('groupFramesByChapters（C5, plan 2026-09-19）', () => {
  it('无章节 → 单一未分组桶（调用方走原网格，零回归）', () => {
    const frames = [{ ref: 'kf:a', at: 100 }, { ref: 'kf:b', at: 900 }]
    expect(groupFramesByChapters(frames, [])).toEqual([{ chapter: null, frames }])
  })

  it('帧按区间归章；首章之前与无时间帧进未分组桶', () => {
    const groups = groupFramesByChapters(
      [
        { ref: 'kf:early', at: 10 },
        { ref: 'kf:a', at: 500 },
        { ref: 'kf:b', at: 1500 },
        { ref: 'kf:none', at: null }
      ],
      [chapter(300, '甲'), chapter(1000, '乙')]
    )
    expect(groups.map((g) => g.chapter?.title ?? '(loose)')).toEqual(['(loose)', '甲', '乙'])
    expect(groups[0]?.frames.map((f) => f.ref)).toEqual(['kf:early', 'kf:none'])
    expect(groups[1]?.frames.map((f) => f.ref)).toEqual(['kf:a'])
    expect(groups[2]?.frames.map((f) => f.ref)).toEqual(['kf:b'])
  })

  it('空章节不进结果（空 section 纪律）', () => {
    const groups = groupFramesByChapters([{ ref: 'kf:a', at: 50 }], [chapter(0, '有'), chapter(900, '空')])
    expect(groups.map((g) => g.chapter?.title)).toEqual(['有'])
  })
})
