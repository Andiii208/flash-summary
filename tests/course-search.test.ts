import { describe, expect, it } from 'vitest'
import { courseMatchesQuery } from '../src/shared/course-search'
import type { CourseTreeInfo } from '../src/shared/bridge'

/** 批4 (plan 2026-09-13, D7): the ONE predicate behind the sidebar search and
 *  the fullscreen browser. The fields that actually disambiguate 1654 local
 *  courses (212 share the name «学位英语») must all match. */
function course(overrides: Partial<CourseTreeInfo> = {}): CourseTreeInfo {
  return {
    id: '1690390',
    name: '泵站设计(CAD)',
    term: '2026-2027',
    teacher: '于洋',
    subjCode: 'MS000156',
    classroom: '李文正527',
    courTimes: '周一 第3-4节',
    lessons: [{ id: 'les-1', title: '第3节课', hasNote: false }],
    ...overrides
  }
}

describe('courseMatchesQuery', () => {
  it('matches nothing for a blank query (everything passes through)', () => {
    expect(courseMatchesQuery(course(), '')).toBe(true)
    expect(courseMatchesQuery(course(), '   ')).toBe(true)
  })

  it('matches name case-insensitively', () => {
    expect(courseMatchesQuery(course({ name: 'Python语言设计' }), 'python')).toBe(true)
    expect(courseMatchesQuery(course(), '泵站')).toBe(true)
  })

  it('matches teacher, term and course id', () => {
    expect(courseMatchesQuery(course(), '于洋')).toBe(true)
    expect(courseMatchesQuery(course(), '2026-2027')).toBe(true)
    expect(courseMatchesQuery(course(), '1690390')).toBe(true)
  })

  it('matches classroom, courTimes and subject code (批4 additions)', () => {
    expect(courseMatchesQuery(course(), '李文正527')).toBe(true)
    expect(courseMatchesQuery(course(), '周一')).toBe(true)
    expect(courseMatchesQuery(course(), 'ms000156')).toBe(true)
  })

  it('matches lesson titles', () => {
    expect(courseMatchesQuery(course(), '第3节')).toBe(true)
  })

  it('rejects non-matching queries', () => {
    expect(courseMatchesQuery(course(), '线性代数')).toBe(false)
    expect(courseMatchesQuery(course(), '汪海')).toBe(false)
  })

  it('trims the query', () => {
    expect(courseMatchesQuery(course(), ' 于洋 ')).toBe(true)
  })
})
