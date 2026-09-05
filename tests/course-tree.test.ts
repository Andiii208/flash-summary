import { describe, expect, it } from 'vitest'
import { mergeCourseTree } from '../src/shared/notes/course-tree'
import type { TreeNode } from '../src/shared/notes/schema'

const tree = (title: string, children: TreeNode[]): TreeNode => ({ title, children })

describe('mergeCourseTree (M4.1 课程总导图, 2026-09-05)', () => {
  it('orders lessons by their «第N节» number and splices each tree under its title', () => {
    const merged = mergeCourseTree('数据结构', [
      { lessonTitle: '第3节课 图', tree: tree('图', [tree('遍历', [])]) },
      { lessonTitle: '第1节课 线性表', tree: tree('线性表', [tree('顺序表', []), tree('链表', [])]) },
      { lessonTitle: '第10节课 排序', tree: tree('排序', [tree('快排', [])]) }
    ])
    expect(merged.title).toBe('数据结构')
    expect(merged.children.map((lesson) => lesson.title)).toEqual([
      '第1节课 线性表',
      '第3节课 图',
      '第10节课 排序'
    ])
    // The lesson's topic tree branches splice UNDER the lesson row (L10 < L2 lesson).
    expect(merged.children[0]!.children.map((branch) => branch.title)).toEqual(['顺序表', '链表'])
    expect(merged.children[2]!.children[0]!.title).toBe('快排')
  })

  it('keeps lessons without a number at the tail in original order', () => {
    const merged = mergeCourseTree('课程', [
      { lessonTitle: '补充专题', tree: tree('补充专题', []) },
      { lessonTitle: '第2节课 进阶', tree: tree('进阶', []) },
      { lessonTitle: '第1节课 基础', tree: tree('基础', []) }
    ])
    expect(merged.children.map((lesson) => lesson.title)).toEqual(['第1节课 基础', '第2节课 进阶', '补充专题'])
  })

  it('returns a bare course root when no lesson has a note yet', () => {
    const merged = mergeCourseTree('新课', [])
    expect(merged).toEqual({ title: '新课', children: [] })
  })
})
