/**
 * 质量批4 (plan 2026-09-08 note-quality-overhaul): 存量升级选择对话框。
 * 列出课程内各课时最新版笔记的体检结果；默认勾选 warn>0 的课时（可全选），
 * 确认后由 App 逐课走 notes:regenerate（复用转写+关键帧，零下载，串行）。
 */
import { useEffect, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { NoteHealthInfo } from '../../shared/bridge'
import { Dialog } from '../ui/Dialog'

/** D2=A 默认勾选口径：体检不达标（warn>0）的课时；损坏档（weak 3 项）天然入选。 */
export function defaultSelection(items: NoteHealthInfo[]): string[] {
  return items.filter((item) => item.warnCount > 0).map((item) => item.lessonId)
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
    if (!loading) setSelected(new Set(defaultSelection(items)))
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
