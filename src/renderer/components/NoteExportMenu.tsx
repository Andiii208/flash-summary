import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { ChevronDown } from 'lucide-preact'

export interface NoteExportMenuProps {
  onExportAnki?: () => void
  onExport?: () => void
  onExportObsidian?: () => void
  /** The in-flight export kind (null = idle) — disables every item and marks the busy one. */
  exportBusy?: string | null
}

/**
 * P48 (plan 2026-09-22-qa-dock-float-window): 「其它导出」菜单——笔记工具行的导出格式
 * 收纳。工具行在 640 阅读轴上原本平铺 9 个按钮（体检/重新生成/复制/三个导出/PDF +
 * 课时导航），自由换行成 ragged 两堆、分隔线被换行切断（Andiii：「布局太混乱了，一点
 * 也不整齐……不符合正常人的审美和使用逻辑」）。收整后：课时导航移题头行；导出保留
 * 主行动「导出 PDF 讲义」一颗，Anki / Markdown / Obsidian 收进本菜单——一行三组
 * （维护 · 输出 · 主行动），组内不换行、组间才换。
 *
 * 交互对齐 LessonChip 的下拉（同仓库既有形制）：点外关闭、Escape 关闭并聚焦回触发器、
 * role=menu/menuitem、busy 时全禁 + 在途项显示「导出中…」。
 */
export function NoteExportMenu({ onExportAnki, onExport, onExportObsidian, exportBusy = null }: NoteExportMenuProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (rootRef.current != null && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const onRootKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && open) {
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const items: { key: string; label: string; busy: boolean; title?: string; run: () => void }[] = []
  if (onExportAnki != null) items.push({ key: 'anki', label: '导出 Anki', busy: exportBusy === 'anki', run: onExportAnki })
  if (onExport != null) items.push({ key: 'markdown', label: '导出 Markdown', busy: exportBusy === 'markdown', run: onExport })
  if (onExportObsidian != null) {
    items.push({
      key: 'obsidian',
      label: '导出 Obsidian',
      busy: exportBusy === 'obsidian',
      title: '结构化 Markdown 写入 Obsidian 仓库（首次需选择仓库目录）',
      run: onExportObsidian
    })
  }
  if (items.length === 0) return null

  return (
    <span class="note-export-menu" ref={rootRef} onKeyDown={onRootKeyDown}>
      <button
        class="btn small note-export-trigger"
        ref={triggerRef}
        aria-expanded={open}
        title="其它导出格式（Anki / Markdown / Obsidian）"
        onClick={() => setOpen((o) => !o)}
      >
        其它导出
        <ChevronDown size={12} strokeWidth={1.75} class={`chip-caret${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div class="note-export-items" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              disabled={exportBusy != null}
              title={item.title}
              onClick={() => {
                setOpen(false)
                item.run()
              }}
            >
              {item.busy ? '导出中…' : item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
