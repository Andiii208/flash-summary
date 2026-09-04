import { describe, expect, it } from 'vitest'
import { SUBJECT_INKS, subjectInk } from '../src/shared/subject-ink'

describe('subjectInk (V2 书脊学科墨水)', () => {
  it('returns a member of the closed six-ink palette', () => {
    for (const id of ['1690625', '1691584', '1', '9999999', 'x', '']) {
      expect(SUBJECT_INKS).toContain(subjectInk(id))
    }
  })

  it('is deterministic: the same id always wears the same ink', () => {
    for (const id of ['1690625', '42', 'Python语言设计']) {
      expect(subjectInk(id)).toBe(subjectInk(id))
    }
  })

  it('spreads distinct ids across more than one hue', () => {
    const inks = new Set(Array.from({ length: 60 }, (_, i) => subjectInk(`course-${i}`)))
    expect(inks.size).toBeGreaterThan(3)
  })
})
