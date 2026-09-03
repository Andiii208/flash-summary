import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { TaskProgressInfo, TaskRowInfo } from '../../shared/bridge'
import { humanizeTaskError } from '../../shared/errors'
import { PIPELINE_STAGES, STAGE_LABELS, stageLabel } from '../labels'
import { ProgressBar } from './ProgressBar'
import { EmptyState } from './EmptyState'
import { Dialog } from '../ui/Dialog'

export interface TaskPanelProps {
  currentLesson: string
  running: boolean
  busy: boolean
  progress: TaskProgressInfo | null
  history: TaskRowInfo[]
  /** Recent tasks across all lessons (shown while no lesson is selected). */
  globalHistory: TaskRowInfo[]
  onCreateRun: () => void
  onRetry: (taskId: string) => void
  onCancel: () => void
  /** M1-2: delete one terminal history row. */
  onDelete: (taskId: string) => void
  /** M1-2: clear every terminal history row. */
  onClearFinished: () => void
}

type HistoryFilter = 'all' | 'running' | 'succeeded' | 'failed'

const FILTER_LABELS: Array<{ id: HistoryFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '进行中' },
  { id: 'succeeded', label: '已完成' },
  { id: 'failed', label: '失败/取消' }
]

function matchFilter(row: TaskRowInfo, filter: HistoryFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'running') return row.state !== 'succeeded' && row.state !== 'failed'
  return row.state === filter
}

/** 课程名 · 课时名 with the raw id as the fallback/tooltip (M1-2). */
function taskLabel(row: TaskRowInfo): string {
  const names = [row.course_name, row.lesson_title].filter((n): n is string => n != null && n !== '')
  return names.length > 0 ? names.join(' · ') : row.lesson_id
}

export function TaskPanel({
  currentLesson,
  running,
  busy,
  progress,
  history,
  globalHistory,
  onCreateRun,
  onRetry,
  onCancel,
  onDelete,
  onClearFinished
}: TaskPanelProps): JSX.Element {
  const noLesson = currentLesson === ''
  return (
    <section class="task-panel">
      <h2>任务</h2>
      {noLesson ? (
        <>
          <EmptyState title="先选择课时" hint="从左侧课程树点击一个课时，即可创建并运行任务。" />
          <h3 class="subheading">全部任务（最近 50 条）</h3>
          <HistoryList history={globalHistory} onRetry={onRetry} disabled={running} onDelete={onDelete} onClearFinished={onClearFinished} />
        </>
      ) : (
        <>
          <p class="msg">已选课时：{currentLesson}</p>
          <button class="btn primary" onClick={onCreateRun} disabled={running || busy}>
            {busy ? '提交中…' : running ? '运行中…' : '创建并运行'}
          </button>
          {running && (
            <button class="btn danger" onClick={onCancel} disabled={busy}>
              取消任务
            </button>
          )}
          {progress != null && <TaskStatusCard progress={progress} />}
          <h3 class="subheading">本课时历史任务</h3>
          <HistoryList history={history} onRetry={onRetry} disabled={running} onDelete={onDelete} onClearFinished={onClearFinished} />
        </>
      )}
    </section>
  )
}

interface TaskStatusCardProps {
  progress: TaskProgressInfo
}

function TaskStatusCard({ progress }: TaskStatusCardProps): JSX.Element {
  const failed = progress.state === 'failed'
  const succeeded = progress.state === 'succeeded'
  // Position of the furthest reached stage on the rail.
  const reached = succeeded
    ? PIPELINE_STAGES.length
    : Math.max(0, PIPELINE_STAGES.indexOf((progress.stage ?? progress.state) as (typeof PIPELINE_STAGES)[number]))
  return (
    <div class={`task-status${failed ? ' failed' : ''}`} data-testid="task-status">
      <div class="task-status-line">
        <span class="task-id">任务 {progress.taskId}</span>
        <span class={`task-stage${succeeded ? ' done' : ''}`}>{stageLabel(progress.state, progress.stage)}</span>
      </div>
      <div class="stage-rail">
        {PIPELINE_STAGES.map((stage, i) => {
          const cls = i < reached ? 'done' : i === reached ? (failed ? 'error' : 'active') : 'todo'
          return (
            <div key={stage} class={`stage-step ${cls}`} title={STAGE_LABELS[stage]}>
              <span class="stage-dot" />
              <span class="stage-name">{STAGE_LABELS[stage]}</span>
            </div>
          )
        })}
      </div>
      <ProgressBar percent={progress.percent} active={!succeeded && !failed} />
      {progress.detail != null && <p class="task-detail">{progress.detail}</p>}
      {failed && <p class="task-error">{progress.message}</p>}
    </div>
  )
}

interface HistoryListProps {
  history: TaskRowInfo[]
  onRetry: (taskId: string) => void
  disabled: boolean
  onDelete: (taskId: string) => void
  onClearFinished: () => void
}

function HistoryList({ history, onRetry, disabled, onDelete, onClearFinished }: HistoryListProps): JSX.Element {
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [confirmClear, setConfirmClear] = useState(false)
  if (history.length === 0) return <p class="msg">暂无任务</p>
  const visible = history.filter((row) => matchFilter(row, filter))
  const clearable = history.filter((row) => row.state === 'succeeded' || row.state === 'failed').length
  return (
    <div class="history-list">
      <div class="history-tools">
        <div class="filter-chips" role="group" aria-label="任务筛选">
          {FILTER_LABELS.map((f) => (
            <button key={f.id} class={`chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {clearable > 0 && (
          <button class="btn small ghost" onClick={() => setConfirmClear(true)}>
            清空记录
          </button>
        )}
      </div>
      <Dialog
        open={confirmClear}
        title={`清空 ${clearable} 条已结束的任务记录？`}
        message="只删除任务记录与其缓存文件，正在运行的任务不受影响；课程与笔记不会删除。"
        confirmLabel="清空"
        danger
        onConfirm={() => {
          setConfirmClear(false)
          onClearFinished()
        }}
        onCancel={() => setConfirmClear(false)}
      />
      {visible.length === 0 && <p class="msg">该筛选下暂无任务</p>}
      {visible.map((row) => (
        <div key={row.id} class="item history-row">
          <span class={`history-state state-${row.state}`}>{stageLabel(row.state, row.failed_stage)}</span>
          <span class="history-lesson" title={row.lesson_id}>
            {taskLabel(row)}
          </span>
          {row.error_message != null && (
            <span class="history-error" title={row.error_message}>
              {humanizeTaskError(row.error_message, row.error_kind)}
            </span>
          )}
          {row.state === 'failed' && (
            <button class="btn small" onClick={() => onRetry(row.id)} disabled={disabled}>
              重试
            </button>
          )}
          {(row.state === 'succeeded' || row.state === 'failed') && (
            <button class="btn small ghost" title="删除这条记录" onClick={() => onDelete(row.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
