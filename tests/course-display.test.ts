import { describe, expect, it } from 'vitest'
import { courseAvatarChar } from '../src/shared/course-display'

/** A6 (plan 2026-09-13): the one-glyph course avatar must not render a lone
 *  bracket for names that open with punctuation (Bilibili imports do). */
describe('courseAvatarChar', () => {
  it('skips leading punctuation and picks the first letter/digit', () => {
    expect(courseAvatarChar('（中英字幕完结）斯坦福CS224N《深度学习自然语言处理》')).toBe('中')
    expect(courseAvatarChar('(全英文) 网络信息编程')).toBe('全')
    expect(courseAvatarChar(' —— 破折号开头的课')).toBe('破')
    expect(courseAvatarChar('「引号课」')).toBe('引')
  })

  it('keeps the first meaningful glyph for ordinary names', () => {
    expect(courseAvatarChar('电子电路及系统I课程设计')).toBe('电')
    expect(courseAvatarChar('Python语言设计')).toBe('P')
    expect(courseAvatarChar('2026 秋季专题')).toBe('2')
    expect(courseAvatarChar('学位英语')).toBe('学')
  })

  it('falls back to the raw first character for all-punctuation names, and empty for empty', () => {
    expect(courseAvatarChar('《《》》')).toBe('《')
    expect(courseAvatarChar('···')).toBe('·')
    expect(courseAvatarChar('')).toBe('')
  })
})
