import { useEffect, useRef } from 'preact/hooks'
import type { JSX } from 'preact'
import type { TreeNode } from '../../shared/notes/schema'
import { MindMap } from './MindMap'
import { useModalScrollLock } from '../ui/use-modal-scroll-lock'
import { useFocusTrap } from '../ui/use-focus-trap'

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
 * 批3: Esc 关闭（与 Dialog/BiliImportDialog 同一惯例）+ 空态卡。
 */
export function CourseMapDialog({ info, onClose }: { info: CourseMapInfo; onClose: () => void }): JSX.Element {
  useModalScrollLock(true)
  // 健康巡查 2026-09-12 批6: same focus discipline as Dialog.
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, cardRef)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
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
      <div class="course-map-card" data-testid="course-map-dialog" ref={cardRef}>
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
        {info.lessons === 0 ? (
          <div class="course-map-empty" data-testid="course-map-empty">
            该课程还没有可用的笔记导图——生成笔记后，课时导图会自动聚合在这里。
          </div>
        ) : (
          <MindMap tree={info.tree} />
        )}
      </div>
    </div>
  )
}
