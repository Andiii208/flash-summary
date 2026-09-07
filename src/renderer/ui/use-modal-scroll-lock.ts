/**
 * 批7 #5 收口（plan 2026-09-07 v07）：打开模态层时锁定背景滚动。
 * 共享 Dialog 一直有这条，BiliImportDialog / CourseMapDialog 漏了——
 * 图片放大时笔记在背后滑动是「页面在动」的错觉，B站导入/课程导图同理。
 */
import { useEffect } from 'preact/hooks'

export function useModalScrollLock(open: boolean): void {
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])
}
