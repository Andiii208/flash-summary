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
  /** 批2 (plan 2026-09-20, P4): 该课时的失败原因（main 侧 res.error 原文）。 */
  reasonOf?: (lessonId: string) => string | undefined
  onRun: (lessonIds: string[]) => void
  onClose: () => void
}

export function NoteUpgradeDialog({ open, courseLabel, loading, items, busy, statusOf, reasonOf, onRun, onClose }: NoteUpgradeDialogProps): JSX.Element | null {
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
  // 批2 (P6，含评审补口): 已完成课时在**这一处**统一裁掉，而且**计数与禁用都基于
  // 裁完的集合**——否则会出现一个新的死角：跑完一轮成功后 done 项仍留在 selected
  // 里（行显示「✓ 已升级」、checkbox 保持勾选），按钮却还写着「升级所选（1）」且
  // 可点，点下去 `onRun([])` 被 hook 的空数组早退吃掉：无 toast、无状态变化、弹层
  // 原样留着（本方案 §0 把这类「点了完全没反应」定为 high）。toggle/全选/reseed 不动。
  const runnable = [...selected].filter((lessonId) => statusOf(lessonId) !== 'done')
  return (
    <Dialog
      open={open}
      title={`升级旧笔记 — ${courseLabel}`}
      message={
        loading
          ? '正在读取体检结果…'
          : runnable.length === 0 && selected.size > 0
            ? '所选课时都已升级，无需重跑。'
            : '默认勾选体检不达标的课时；升级只重新生成笔记，不重新下载视频。'
      }
      confirmLabel={busy ? '升级中…' : `升级所选（${runnable.length}）`}
      confirmDisabled={busy || loading || runnable.length === 0}
      cancelDisabled={busy}
      onConfirm={() => onRun(runnable)}
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
            const reason = status === 'failed' ? reasonOf?.(item.lessonId) : undefined
            return (
              <label key={item.lessonId} class={`note-upgrade-row${status === 'done' ? ' done' : ''}`}>
                <input type="checkbox" checked={selected.has(item.lessonId)} disabled={busy || status === 'done'} onChange={() => toggle(item.lessonId)} />
                <span class="note-upgrade-title">
                  {item.lessonTitle}
                  {/* 批2 (P4): 失败原因就地可见（标题下方一行小字）——「失败」两个字此前是
                      全部信息，而 main 侧的守卫（任务占用 / 未绑模型 / 超时）本来就给了原因。 */}
                  {reason != null && <span class="msg note-upgrade-reason">{reason}</span>}
                </span>
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
