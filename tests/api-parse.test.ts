import { describe, expect, it } from 'vitest'
import {
  isCasLoginRedirect,
  cookieStringFromSetCookies,
  mergeCookieStrings,
  parseCourseList,
  parseCoursePageCount,
  parseLessonDetail,
  parseTermList
} from '../src/main/school/api-parse'

describe('login redirect detection', () => {
  it('flags CAS hosts and login paths', () => {
    expect(isCasLoginRedirect('https://ids.seu.edu.cn/authserver/login?service=x')).toBe(true)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/cas/login')).toBe(true)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/v1/course/list')).toBe(false)
  })

  // H30 (audit 2026-09-28): 旧正则 `/(cas|login|sso)|ids.seu.edu.cn|authserver`
  // 扫全串，任何含 login 的查询串、auth.seu.edu.cn 的 OAuth 正常跳转都被误报
  // session_expired。收紧为「路径段级匹配 + 已知 CAS 主机清单」后逐条钉住。
  it('H30: 合法 CAS 跳转仍然判过期', () => {
    // 平台自己的登录页（路径段）。
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/cas/login')).toBe(true)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/login')).toBe(true)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/sso/entry')).toBe(true)
    // 已知 CAS 主机（ids.seu.edu.cn）上任何路径。
    expect(isCasLoginRedirect('https://ids.seu.edu.cn/authserver/login?service=x')).toBe(true)
    expect(isCasLoginRedirect('https://ids.seu.edu.cn/')).toBe(true)
    expect(isCasLoginRedirect('https://sub.ids.seu.edu.cn/whatever')).toBe(true)
    // 大小写不敏感（旧正则是 /i）。
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/CAS/LOGIN')).toBe(true)
    // SPA 的 hash 路由也算路径（平台是 hash 路由）。
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/jy-application-resourcemanage-ui/#/login')).toBe(true)
    // 查询里嵌了完整的登录 URL（SSO 回跳的 redirect 参数）。
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/?redirect=https://ids.seu.edu.cn/authserver/login')).toBe(true)
    // 非 URL 原文（client.ts 会把 2xx HTML 登录页正文喂进来）。
    expect(isCasLoginRedirect('<html><body>authserver login</body></html>')).toBe(true)
    expect(isCasLoginRedirect('/authserver/login')).toBe(true)
  })

  it('H30: 普通平台跳转不再误报（查询串/前缀词/OAuth 中转站）', () => {
    // 查询串里出现登录词 ≠ 登录页（旧实现的头号误报源）。
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/?redirect=authserver')).toBe(false)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/api/list?next=/login')).toBe(false)
    // 路径段级匹配：login-history / prelogin 不是 login 段。
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/api/login-history')).toBe(false)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/prelogin')).toBe(false)
    // auth.seu.edu.cn 是 OAuth 授权中转站——静默 SSO 的正常路径，不是掉登录。
    expect(isCasLoginRedirect('https://auth.seu.edu.cn/oauth/authorize')).toBe(false)
    // 正常业务路由与播放页 hash 路由。
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/v1/group_subject_vod_list/t-1?page.pageIndex=1')).toBe(false)
    expect(isCasLoginRedirect('https://cvs.seu.edu.cn/jy-application-resourcemanage-ui/#/play-video?courseId=1')).toBe(false)
    // 与登录词无关的杂串。
    expect(isCasLoginRedirect('not a url')).toBe(false)
    expect(isCasLoginRedirect('https://media.example.com/v.mp4')).toBe(false)
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

describe('parseTermList (platform term catalog, plan 2026-10-07)', () => {
  it('parses the live /v1/list/termYear shape (field sample 2026-10-07, redacted)', () => {
    const terms = parseTermList([
      { acteBeginDate: 1789920000000, acteEndDate: 1800806400000, acteTerm: 2, acyeCode: '2026-2027', currentTerm: false, id: 37 },
      { acteBeginDate: 1787500800000, acteEndDate: 1800806400000, acteTerm: 1, acyeCode: '2026-2027', currentTerm: true, id: 36 },
      { acteBeginDate: 1772380800000, acteEndDate: 1784908800000, acteTerm: 3, acyeCode: '2025-2026', currentTerm: false, id: 35 }
    ])
    expect(terms).toEqual([
      { id: 37, academicYear: '2026-2027', term: 2, currentTerm: false, label: '2026-2027 第二学期' },
      { id: 36, academicYear: '2026-2027', term: 1, currentTerm: true, label: '2026-2027 第一学期' },
      { id: 35, academicYear: '2025-2026', term: 3, currentTerm: false, label: '2025-2026 第三学期' }
    ])
  })

  it('tolerates envelope wrapping and string ids', () => {
    const terms = parseTermList({ code: null, data: [{ id: '29', acyeCode: '2024-2025', acteTerm: 1, currentTerm: false }] })
    expect(terms).toEqual([{ id: 29, academicYear: '2024-2025', term: 1, currentTerm: false, label: '2024-2025 第一学期' }])
  })

  it('drops records the refresh could not filter on (no id / no year)', () => {
    expect(parseTermList([{ acyeCode: '2026-2027', acteTerm: 1 }, { id: 5, acteTerm: 1 }])).toEqual([])
  })
})

describe('parseCourseList canonical term (plan 2026-10-07)', () => {
  it('builds YYYY-YYYY-N from acyeBeginYear/acyeEndYear + acteName', () => {
    const courses = parseCourseList([
      {
        id: '1778445',
        subjName: '大学物理(B)Ⅱ',
        acyeBeginYear: 2026,
        acyeEndYear: 2027,
        acteName: '2'
      }
    ])
    expect(courses[0].term).toBe('2026-2027-2')
  })

  it('falls back to the year range alone when the term number is missing (legacy shape)', () => {
    const courses = parseCourseList([{ id: '1691584', subjName: '网络信息编程（全英文）', acyeBeginYear: 2026, acyeEndYear: 2027 }])
    expect(courses[0].term).toBe('2026-2027')
  })
})
