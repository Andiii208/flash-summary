import { describe, expect, it } from 'vitest'
import { orderMyCoursesFirst, orderLessonsByNumber, orderTreeLessonsByNumber } from '../src/shared/course-order'
import type { CourseTreeInfo } from '../src/shared/bridge'

function course(partial: Partial<CourseTreeInfo> & { id: string }): CourseTreeInfo {
  return { name: `课${partial.id}`, lessons: [], ...partial }
}

describe('orderMyCoursesFirst (C2/C4 + M1-4 recommendation ordering)', () => {
  const tree: CourseTreeInfo[] = [
    course({ id: 'a', subjCode: 'CS1' }),
    course({ id: 'b', subjCode: 'CS1' }),
    course({ id: 'c', isMine: true, subjCode: 'MA2' }),
    course({ id: 'd', subjCode: 'MA2' }),
    course({ id: 'e', subjCode: 'PH9' }),
    course({ id: 'x', hasExtracted: true, noteCount: 3 }),
    course({ id: 'f' })
  ]

  it('tiers pinned → extracted → same-subject sections → the rest, order preserved', () => {
    const { tree: ordered, sameCourseIds } = orderMyCoursesFirst(tree)
    // c is pinned (MA2): its same-subject section d comes after the
    // extracted tier; CS1 has no pinned course, so a/b stay low.
    expect(ordered.map((c) => c.id)).toEqual(['c', 'x', 'd', 'a', 'b', 'e', 'f'])
    expect(sameCourseIds).toEqual(new Set(['d']))
  })

  it('extracted courses float up with no manual action (M1-4 core ask)', () => {
    const { tree: ordered } = orderMyCoursesFirst([course({ id: 'plain' }), course({ id: 'studied', hasExtracted: true })])
    expect(ordered.map((c) => c.id)).toEqual(['studied', 'plain'])
  })

  it('keeps everything in the rest tier when nothing is pinned or extracted', () => {
    const { tree: ordered, sameCourseIds } = orderMyCoursesFirst([course({ id: 'x' }), course({ id: 'y', subjCode: 'S' })])
    expect(ordered.map((c) => c.id)).toEqual(['x', 'y'])
    expect(sameCourseIds.size).toBe(0)
  })

  it('treats an empty subjCode on a pinned course as no recommendation key', () => {
    const { tree: ordered, sameCourseIds } = orderMyCoursesFirst([course({ id: 'm', isMine: true, subjCode: '' }), course({ id: 'n', subjCode: '' })])
    expect(ordered.map((c) => c.id)).toEqual(['m', 'n'])
    expect(sameCourseIds.size).toBe(0)
  })
})

describe('orderLessonsByNumber / orderTreeLessonsByNumber (批2 A4)', () => {
  it('orders lessons by their «第N节» number, numberless rows tail stably', () => {
    const lessons = [{ id: 'a', title: '第12节课' }, { id: 'b', title: '第2节课' }, { id: 'c', title: '附加材料' }, { id: 'd', title: '第1节课' }]
    expect(orderLessonsByNumber(lessons).map((l) => l.id)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('applies the ordering across the whole tree', () => {
    const tree = [
      { id: 'c1', name: '课一', lessons: [{ id: 'c1-L1', title: '第2节课', hasNote: false }, { id: 'c1-L0', title: '第1节课', hasNote: true }] }
    ]
    expect(orderTreeLessonsByNumber(tree)[0]!.lessons.map((l) => l.id)).toEqual(['c1-L0', 'c1-L1'])
  })
})
