import type { JSX } from 'preact'
import type { TreeNode } from '../../shared/notes/schema'
import { MindMap } from './MindMap'

export interface CourseMapInfo {
  courseName: string
  tree: TreeNode
  lessons: number
  skipped: number
}

/**
 * M4.1: modal surface for the course-level map (决策点 D7 — the entry lives
 * on the course card in the tree). The dialog reuses the full MindMap
 * interaction stack: depth controls, search, zoom/pan, focus, recall.
 * No concepts/quiz here — popovers stay hidden, 课时边界纪律 holds.
 */
export function CourseMapDialog({ info, onClose }: { info: CourseMapInfo; onClose: () => void }): JSX.Element {
  return (
    <div
      class="course-map-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`课程导图：${info.courseName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div class="course-map-card" data-testid="course-map-dialog">
        <div class="course-map-head">
          <div>
            <h2>课程导图 · {info.courseName}</h2>
            <p class="course-map-meta">
              {info.lessons} 个课时{info.skipped > 0 ? ` · ${info.skipped} 条损坏笔记已跳过` : ''}
            </p>
          </div>
          <button class="btn small" onClick={onClose}>
            关闭
          </button>
        </div>
        <MindMap tree={info.tree} />
      </div>
    </div>
  )
}
