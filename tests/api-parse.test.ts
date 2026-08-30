import { describe, expect, it } from 'vitest'
import {
  isCasLoginRedirect,
  cookieStringFromSetCookies,
  mergeCookieStrings,
  parseCourseList,
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
})
