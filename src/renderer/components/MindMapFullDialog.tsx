import { useEffect, useRef } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Concept, ConceptLink, TreeNode } from '../../shared/notes/schema'
import { MindMap } from './MindMap'
import { useModalScrollLock } from '../ui/use-modal-scroll-lock'
import { useFocusTrap } from '../ui/use-focus-trap'
import { isTopmostModalLayer } from '../ui/modal-layer'

export interface MindMapFullDialogProps {
  tree: TreeNode
  concepts?: Concept[]
  conceptLinks?: ConceptLink[]
  onViewDetailed?: (term: string) => void
  onExportSvg?: () => void
  onExportPng?: () => void
  exportBusy?: string | null
  onClose: () => void
}

/**
 * P51 (plan 2026-09-22-qa-dock-float-window): 导图「全图」浏览弹层。
 *
 * Andiii：「不需要你设置一个内部的放大缩小，如果适合比例的大小因为元素太多看不清楚的
 * 话，用户可以直接点击全图去看呀」——笔记页里的导图按容器宽适合比例呈现（页面下滑看
 * 完），看不清时点工具栏「全图」开这个近全屏弹层：图在 96vw×92vh 的卡里按宽高拟合
 * （fit='box'），比页内大得多；仍装不下时倍率夹在 MIN_SCALE，卡内滚动兜底。
 *
 * 弹层形制与 CourseMapDialog 同源（SKILL §2 的 overlay 基元 + 滚动锁 + 焦点陷阱 +
 * Esc 只关最上层）。内部不含「全图」钮（onOpenFullMap 不传），不会套娃。
 */
export function MindMapFullDialog({ tree, concepts, conceptLinks, onViewDetailed, onExportSvg, onExportPng, exportBusy, onClose }: MindMapFullDialogProps): JSX.Element {
  useModalScrollLock(true)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, cardRef)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && isTopmostModalLayer(cardRef.current)) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div class="mindmap-full-overlay" role="dialog" aria-modal="true" aria-label="导图全图浏览" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div class="mindmap-full-card" data-testid="mindmap-full-dialog" ref={cardRef}>
        <div class="course-map-head">
          <div>
            <h2>全图浏览</h2>
            <p class="course-map-meta">适合比例放大了看；仍看不全时在此滑动，Esc 或点空白处关闭</p>
          </div>
          <button class="btn small" onClick={onClose} aria-label="关闭全图浏览">
            关闭
          </button>
        </div>
        <MindMap
          tree={tree}
          concepts={concepts}
          conceptLinks={conceptLinks}
          onViewDetailed={onViewDetailed}
          onExportSvg={onExportSvg}
          onExportPng={onExportPng}
          exportBusy={exportBusy}
          fit="box"
        />
      </div>
    </div>
  )
}
