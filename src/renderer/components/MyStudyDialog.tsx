import { useEffect, useRef } from 'preact/hooks'
import type { JSX } from 'preact'
import { MyStudyPanel, type MyStudyPanelProps } from './MyStudyPanel'
import { useModalScrollLock } from '../ui/use-modal-scroll-lock'
import { useFocusTrap } from '../ui/use-focus-trap'

export interface MyStudyDialogProps extends Omit<MyStudyPanelProps, 'headerAction'> {
  open: boolean
  onClose: () => void
}

/**
 * 批4 (plan 2026-09-20, P9/D5): 「我的学习」近全屏展开。用户现象是这一区**根本
 * 没有可展开的入口/状态/挂载点**——侧栏 304px 装不下课程行的副题，与「全部课程」
 * 同一个问题。形制完全照抄全屏课程浏览器（滚动锁 + focus trap + Esc + 右上关闭键
 * + aria-label），面板本体复用 MyStudyPanel，两个宿主的分组与操作因此永远一致。
 */
export function MyStudyDialog({ open, onClose, onSelect, ...panelProps }: MyStudyDialogProps): JSX.Element | null {
  useModalScrollLock(open)
  const cardRef = useRef<HTMLDivElement>(null)
  useFocusTrap(open, cardRef)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      class="fullscreen-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div class="my-study-card" role="dialog" aria-modal="true" aria-label="我的学习" data-testid="my-study-dialog" ref={cardRef}>
        <div class="my-study-body">
          <MyStudyPanel
            {...panelProps}
            onSelect={(lessonId) => {
              // 先例在组件内（CourseBrowser.tsx 的 onSelectLesson + onClose）：
              // 选中即关闭——弹层挡着笔记页时「选了却停在原地」会被读成没反应。
              onSelect(lessonId)
              onClose()
            }}
            headerAction={
              <button class="btn small" onClick={onClose} aria-label="关闭我的学习">
                关闭
              </button>
            }
          />
        </div>
      </div>
    </div>
  )
}
