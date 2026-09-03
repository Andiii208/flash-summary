import { describe, expect, it } from 'vitest'
import {
  isCasLoginRedirect,
  cookieStringFromSetCookies,
  mergeCookieStrings,
  parseCourseList,
  parseCoursePageCount,
  parseLessonDetail
} from '../src/main/school/api-parse'

describe('login redirect detection', () => {
  it('flags CAS hosts and login paths', () => {
    expect(isCasLoginRedirect('https://ids.seu.edu.cn/authserver/login?service=x')).toBe(true)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/cas/login')).toBe(true)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/v1/course/list')).toBe(false)
  })
})

describe('cookie helpers', () => {
  it('strips Set-Cookie attributes', () => {
    const cookie = cookieStringFromSetCookies([
      'JSESSIONID=abc; Path=/; HttpOnly; Secure',
      'CASTGT=ticket; Path=/cas; HttpOnly'
    ])
    expect(cookie).toBe('JSESSIONID=abc; CASTGT=ticket')
  })

  it('merges cookie strings with new values winning', () => {
    expect(mergeCookieStrings('A=1; B=2', 'B=3; C=4')).toBe('A=1; B=3; C=4')
  })
})

describe('course list parsing', () => {
  it('parses a bare array payload', () => {
    const courses = parseCourseList([
      { courseId: 'c1', courseName: '高等数学', term: '2026春', teacherName: '王老师' },
      { id: 'c2', name: '大学物理' }
    ])
    expect(courses).toEqual([
      { id: 'c1', name: '高等数学', term: '2026春', teacher: '王老师' },
      { id: 'c2', name: '大学物理' }
    ])
  })

  it('parses a { list: [...] } wrapper and drops entries without id', () => {
    const courses = parseCourseList({ list: [{ courseId: 'c1', courseName: 'x' }, { name: 'no-id' }] })
    expect(courses).toEqual([{ id: 'c1', name: 'x' }])
  })
})

describe('lesson detail parsing', () => {
  it('maps teacher and screen streams, never panorama', () => {
    const detail = parseLessonDetail(
      {
        lessonId: 'l1',
        title: '第五讲',
        startTime: '2026-03-02 08:00',
        duration: 5400,
        pptCourseId: 'ppt-9',
        playUrls: [
          { type: '1170193-1', url: 'http://media/teacher.m3u8' },
          { type: '1170195-5', url: 'http://media/screen.m3u8' },
          { type: '1170194-3', url: 'http://media/panorama.m3u8' }
        ]
      },
      'c1'
    )
    expect(detail).toEqual({
      id: 'l1',
      courseId: 'c1',
      title: '第五讲',
      startedAt: '2026-03-02 08:00',
      durationSeconds: 5400,
      teacherStreamUrl: 'http://media/teacher.m3u8',
      screenStreamUrl: 'http://media/screen.m3u8',
      pptCourseId: 'ppt-9'
    })
  })

  it('returns null when payload has no id', () => {
    expect(parseLessonDetail({ title: 'orphan' }, 'c1')).toBeNull()
  })

  it('parses the live t-1 envelope (field sample 2026-09-02)', () => {
    const courses = parseCourseList({
      code: null,
      data: {
        pageIndex: 1,
        records: [
          {
            id: 1691584,
            subjName: '网络信息编程（全英文）',
            subjCode: 'B0803291',
            acyeBeginYear: 2026,
            acyeEndYear: 2027,
            teacNames: ['汪海', '李某'],
            orgaNames: ['自动化学院'],
            teclId: 154717,
            teclCode: '202620271B080329101'
          }
        ]
      }
    })
    expect(courses).toEqual([
      {
        id: '1691584',
        name: '网络信息编程（全英文）',
        term: '2026-2027',
        teacher: '汪海、李某',
        subjCode: 'B0803291',
        teclId: '154717',
        teclCode: '202620271B080329101'
      }
    ])
  })
})

describe('parseCoursePageCount (t-1 pagination, B1)', () => {
  it('reads pageCount from the live data envelope', () => {
    expect(parseCoursePageCount({ code: null, data: { records: [], pageIndex: 1, pageCount: 648 } })).toBe(648)
  })

  it('tolerates the result wrapper and numeric strings', () => {
    expect(parseCoursePageCount({ result: { records: [], totalPages: '3' } })).toBe(3)
    expect(parseCoursePageCount({ pageCount: 2 })).toBe(2)
  })

  it('falls back to a single page when nothing readable is found', () => {
    expect(parseCoursePageCount({ code: '0', result: [] })).toBe(1)
    expect(parseCoursePageCount(null)).toBe(1)
    expect(parseCoursePageCount({ data: { pageCount: 0 } })).toBe(1)
  })
})

describe('parseCourseList course metadata (C1/C3)', () => {
  it('extracts subjCode / clroName / courTimes from the live t-1 record shape', () => {
    const courses = parseCourseList({
      code: null,
      data: {
        records: [
          {
            id: '1691584',
            subjName: '网络信息编程（全英文）',
            subjCode: 'CS3011',
            teacNames: ['汪海'],
            clroName: '中山-312',
            courTimes: ['周一 第3-4节', '周三 第1-2节'],
            teclId: 154717,
            teclCode: '202620271B080329101'
          }
        ],
        pageCount: 648
      }
    })
    expect(courses[0]).toMatchObject({ subjCode: 'CS3011', classroom: '中山-312', courTimes: '周一 第3-4节、周三 第1-2节' })
  })

  it('omits metadata fields when the record carries none', () => {
    const courses = parseCourseList([{ id: 'x1' }])
    expect(courses[0]).toEqual({ id: 'x1', name: '' })
  })
})
