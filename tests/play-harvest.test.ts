import { describe, expect, it } from 'vitest'
import {
  buildPlayPageUrl,
  clickLessonScript,
  lessonNumber,
  parseLessonEntries,
  pickStreamUrls,
  sanitizeStreamUrl
} from '../src/main/school/play-harvest'

describe('buildPlayPageUrl', () => {
  it('builds the hash route with encoded query params', () => {
    const url = buildPlayPageUrl('https://cvs.seu.edu.cn', {
      courseId: '1691584',
      teclId: '154717',
      teclCode: '202620271B080329101'
    })
    expect(url).toBe(
      'https://cvs.seu.edu.cn/jy-application-resourcemanage-ui/#/play-video?courseId=1691584&teclId=154717&teclCode=202620271B080329101'
    )
  })

  it('encodes special characters in ids', () => {
    const url = buildPlayPageUrl('https://cvs.seu.edu.cn', { courseId: 'a b', teclId: 'x&y', teclCode: 'c=d' })
    expect(url).toContain('courseId=a%20b&teclId=x%26y&teclCode=c%3Dd')
  })
})

describe('pickStreamUrls', () => {
  it('classifies by the Kedacom stream ids embedded in the path', () => {
    const picked = pickStreamUrls([
      'https://dncvsvod.seu.edu.cn/storage-3/vod4/SVR-CLOUD-1691584-1170195-5-1.mp4?auth_key=aaa',
      'https://dncvsvod.seu.edu.cn/storage-3/vod4/SVR-CLOUD-1691584-1170193-1-1.mp4?auth_key=bbb'
    ])
    expect(picked.teacherStreamUrl).toContain('1170193')
    expect(picked.screenStreamUrl).toContain('1170195')
  })

  it('falls back to DOM order (first video = teacher) without stream ids', () => {
    const picked = pickStreamUrls(['https://vod/a.mp4?auth_key=x', 'https://vod/b.mp4?auth_key=y'])
    expect(picked.teacherStreamUrl).toBe('https://vod/a.mp4?auth_key=x')
    expect(picked.screenStreamUrl).toBe('https://vod/b.mp4?auth_key=y')
  })

  it('keeps a single stream as the teacher stream', () => {
    const picked = pickStreamUrls(['https://vod/only.mp4?auth_key=z'])
    expect(picked.teacherStreamUrl).toBe('https://vod/only.mp4?auth_key=z')
    expect(picked.screenStreamUrl).toBeUndefined()
  })

  it('returns empty for no sources', () => {
    expect(pickStreamUrls([])).toEqual({})
    expect(pickStreamUrls(['', ''])).toEqual({})
  })
})

describe('sanitizeStreamUrl', () => {
  it('strips the signed query (auth_key red line) and keeps the path', () => {
    expect(sanitizeStreamUrl('https://dncvsvod.seu.edu.cn/storage-3/vod4/SVR-CLOUD-1.mp4?auth_key=secret-expires')).toBe(
      'https://dncvsvod.seu.edu.cn/storage-3/vod4/SVR-CLOUD-1.mp4'
    )
  })

  it('handles URLs without a query', () => {
    expect(sanitizeStreamUrl('https://vod/plain.mp4')).toBe('https://vod/plain.mp4')
  })
})

describe('parseLessonEntries', () => {
  it('assigns DOM-order indexes and refs, trimming whitespace', () => {
    const entries = parseLessonEntries([' 第1节课 ', '第2节课', '第3节课'])
    expect(entries).toEqual([
      { index: 0, title: '第1节课', ref: '0' },
      { index: 1, title: '第2节课', ref: '1' },
      { index: 2, title: '第3节课', ref: '2' }
    ])
  })

  it('collapses duplicate labels across regions (playing header + list)', () => {
    const entries = parseLessonEntries(['第1节课', '第2节课', '第1节课', '第2节课'])
    expect(entries.map((e) => e.title)).toEqual(['第1节课', '第2节课'])
    expect(entries.map((e) => e.ref)).toEqual(['0', '1'])
  })

  it('drops empty candidates', () => {
    expect(parseLessonEntries(['', '第1节课'])).toHaveLength(1)
  })
})

describe('lessonNumber', () => {
  it('extracts the number from 第N节 text', () => {
    expect(lessonNumber('第12节课')).toBe(12)
    expect(lessonNumber('第 3 节')).toBe(3)
    expect(lessonNumber('其他')).toBeNull()
  })
})

describe('clickLessonScript', () => {
  it('bounds-checks the ref before clicking (injected script sanity)', () => {
    const script = clickLessonScript('2')
    expect(script).toContain('lessonCandidates')
    expect(script).toContain('"2"')
    expect(script).toContain('cands[i].click()')
    expect(script).toContain('i >= cands.length')
  })
})
