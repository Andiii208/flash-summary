import { describe, expect, it } from 'vitest'
import { biliCourseId, biliLessonId, parseBiliInput, readPageParam } from '../src/main/bilibili/url-parse'

describe('parseBiliInput', () => {
  it('accepts a bare BV id without a page', () => {
    expect(parseBiliInput('BV1GJ411x7h7')).toEqual({ kind: 'bvid', bvid: 'BV1GJ411x7h7', page: null })
  })

  it('accepts full and mobile video URLs and reads ?p=', () => {
    expect(parseBiliInput('https://www.bilibili.com/video/BV1GJ411x7h7/')).toMatchObject({
      kind: 'bvid',
      bvid: 'BV1GJ411x7h7',
      page: null
    })
    expect(parseBiliInput('https://www.bilibili.com/video/BV1GJ411x7h7?p=3&vd_source=abc')).toEqual({
      kind: 'bvid',
      bvid: 'BV1GJ411x7h7',
      page: 3
    })
    expect(parseBiliInput('https://m.bilibili.com/video/BV1GJ411x7h7?p=12')).toEqual({
      kind: 'bvid',
      bvid: 'BV1GJ411x7h7',
      page: 12
    })
  })

  it('classifies short links and av ids distinctly', () => {
    expect(parseBiliInput('https://b23.tv/BV1GJ411x7h7')).toEqual({ kind: 'short_link' })
    expect(parseBiliInput('av170001')).toEqual({ kind: 'av_unsupported' })
    expect(parseBiliInput('https://www.bilibili.com/video/av170001')).toEqual({ kind: 'av_unsupported' })
  })

  it('rejects garbage and non-video URLs', () => {
    expect(parseBiliInput('')).toBeNull()
    expect(parseBiliInput('hello world')).toBeNull()
    expect(parseBiliInput('https://example.com/video/BV1GJ411x7h7')).toBeNull()
  })
})

describe('readPageParam', () => {
  it('reads 1-based pages and rejects junk', () => {
    expect(readPageParam('https://www.bilibili.com/video/BV1GJ411x7h7?p=2')).toBe(2)
    expect(readPageParam('https://www.bilibili.com/video/BV1GJ411x7h7?p=0')).toBeNull()
    expect(readPageParam('https://www.bilibili.com/video/BV1GJ411x7h7?p=abc')).toBeNull()
    expect(readPageParam('https://www.bilibili.com/video/BV1GJ411x7h7')).toBeNull()
  })
})

describe('canonical ids', () => {
  it('derives course/lesson ids per the migration 009 conventions', () => {
    expect(biliCourseId('BV1GJ411x7h7')).toBe('bili-BV1GJ411x7h7')
    expect(biliLessonId('BV1GJ411x7h7', 2)).toBe('bili-BV1GJ411x7h7-P2')
  })
})
