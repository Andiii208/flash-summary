/**
 * 质量批4 (plan 2026-09-08 note-quality-overhaul): 存量升级选择对话框。
 * 列出课程内各课时最新版笔记的体检结果；默认勾选 warn>0 的课时（可全选），
 * 确认后由 App 逐课走 notes:regenerate（复用转写+关键帧，零下载，串行）。
 */
import { useEffect, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { NoteHealthInfo } from '../../shared/bridge'
import { CURRENT_PROMPT_VERSION } from '../../shared/notes/schema'
import { Dialog } from '../ui/Dialog'

/**
 * 默认勾选口径（批3 2026-09-17 扩一条）：体检不达标（warn>0）的课时，**或者**
 * 由更早工艺版本产出的课时（`promptVersion < CURRENT_PROMPT_VERSION`，含启用该列
 * 之前生成的存量笔记 = 0）。
 *
 * 为什么加第二条：只看 warnCount 会漏掉「旧 prompt 生成、但侥幸没有 warn」的笔记——
 * 用户看着「体检：良好」，却不知道它其实是旧工艺的产物，永远不会被建议升级。
 */
export function defaultSelection(items: NoteHealthInfo[], currentPromptVersion: number): string[] {
  return items.filter((item) => item.warnCount > 0 || (item.promptVersion ?? 0) < currentPromptVersion).map((item) => item.lessonId)
}

const GRADE_LABELS: Record<NoteHealthInfo['grade'], string> = { good: '良好', fair: '待改进', weak: '薄弱' }

export type UpgradeStatus = 'idle' | 'running' | 'done' | 'failed'

export interface NoteUpgradeDialogProps {
  open: boolean
  courseLabel: string
  loading: boolean
  items: NoteHealthInfo[]
  busy: boolean
  statusOf: (lessonId: string) => UpgradeStatus
  onRun: (lessonIds: string[]) => void
  onClose: () => void
}

export function NoteUpgradeDialog({ open, courseLabel, loading, items, busy, statusOf, onRun, onClose }: NoteUpgradeDialogProps): JSX.Element | null {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // Items arrive async — reseed the default selection whenever they land.
  useEffect(() => {
    if (!loading) setSelected(new Set(defaultSelection(items, CURRENT_PROMPT_VERSION)))
  }, [items, loading])
  const toggle = (lessonId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(lessonId)) next.delete(lessonId)
      else next.add(lessonId)
      return next
    })
  }
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.lessonId))
  return (
    <Dialog
      open={open}
      title={`升级旧笔记 — ${courseLabel}`}
      message={loading ? '正在读取体检结果…' : '默认勾选体检不达标的课时；升级只重新生成笔记，不重新下载视频。'}
      confirmLabel={busy ? '升级中…' : `升级所选（${selected.size}）`}
      confirmDisabled={busy || loading || selected.size === 0}
      cancelDisabled={busy}
      onConfirm={() => onRun([...selected])}
      onCancel={onClose}
    >
      {!loading && items.length > 0 && (
        <div class="note-upgrade-list">
          <label class="note-upgrade-all">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={busy}
              onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.lessonId)))}
            />
            全选
          </label>
          {items.map((item) => {
            const status = statusOf(item.lessonId)
            return (
              <label key={item.lessonId} class={`note-upgrade-row${status === 'done' ? ' done' : ''}`}>
                <input type="checkbox" checked={selected.has(item.lessonId)} disabled={busy || status === 'done'} onChange={() => toggle(item.lessonId)} />
                <span class="note-upgrade-title">{item.lessonTitle}</span>
                <span class="badge ok" title={`当前版本`}>
                  v{item.version}
                </span>
                <span class={`note-upgrade-grade ${item.grade}`}>
                  {GRADE_LABELS[item.grade]}
                  {item.warnCount > 0 ? ` · ${item.warnCount} 项` : ''}
                </span>
                <span class="note-upgrade-status">{status === 'running' ? '升级中…' : status === 'done' ? '✓ 已升级' : status === 'failed' ? '失败' : ''}</span>
              </label>
            )
          })}
        </div>
      )}
      {!loading && items.length === 0 && <p class="dialog-message">该课程还没有任何笔记。</p>}
    </Dialog>
  )
}
