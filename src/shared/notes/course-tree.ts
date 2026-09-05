/**
 * Course-level mind map aggregation (M4.1, map expansion 2026-09-05).
 * Pure merge over every lesson's latest knowledgeTree — zero new model
 * calls. Lessons order by their «第N节» number (A4 comparator, shared with
 * the sidebar); each lesson splices its topic tree's branches under its
 * title row. No cross-lesson concept links by design (课时纪律).
 */
import type { TreeNode } from './schema'
import { orderLessonsByNumber } from '../course-order'

export interface CourseTreeEntry {
  lessonTitle: string
  tree: TreeNode
}

export function mergeCourseTree(courseName: string, entries: CourseTreeEntry[]): TreeNode {
  const sorted = orderLessonsByNumber(entries.map((entry) => ({ ...entry, title: entry.lessonTitle })))
  return {
    title: courseName,
    children: sorted.map((entry) => ({ title: entry.lessonTitle, children: entry.tree.children }))
  }
}
