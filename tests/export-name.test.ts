import { describe, expect, it } from 'vitest'
import { noteExportBaseName, safeFileName } from '../src/shared/notes/export-name'

describe('noteExportBaseName (批D)', () => {
  it('joins course, teacher and lesson title with dashes', () => {
    expect(noteExportBaseName({ courseName: '信号与系统', teacher: '张三', lessonTitle: '第3节课' })).toBe(
      '信号与系统 - 张三 - 第3节课'
    )
  })

  it('drops empty segments instead of leaving dangling dashes', () => {
    expect(noteExportBaseName({ courseName: '信号与系统', teacher: '', lessonTitle: '第3节课' })).toBe(
      '信号与系统 - 第3节课'
    )
    expect(noteExportBaseName({ courseName: '信号与系统', lessonTitle: '第3节课' })).toBe('信号与系统 - 第3节课')
    expect(noteExportBaseName({ lessonTitle: '第3节课' })).toBe('第3节课')
  })

  it('falls back to the lesson id, then to «note»', () => {
    expect(noteExportBaseName({ lessonId: '1690625-L0' })).toBe('1690625-L0')
    expect(noteExportBaseName({})).toBe('note')
    expect(noteExportBaseName({ courseName: '   ' })).toBe('note')
  })

  it('sanitizes Windows-unsafe characters', () => {
    expect(noteExportBaseName({ courseName: 'C++/入门:上?', lessonTitle: '第1节课' })).toBe('C++-入门-上- - 第1节课')
    expect(safeFileName('a\\b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i')
    expect(safeFileName('')).toBe('note')
  })

  it('trims whitespace-only teacher to nothing (no double separators)', () => {
    expect(noteExportBaseName({ courseName: '课程', teacher: '   ', lessonTitle: '第2节课' })).toBe('课程 - 第2节课')
  })
})
