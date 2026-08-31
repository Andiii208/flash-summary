import type { JSX } from 'preact'
import type { TaskProgressInfo, TaskRowInfo } from '../../shared/bridge'
import { stageLabel } from '../labels'
import { ProgressBar } from './ProgressBar'
import { EmptyState } from './EmptyState'

export interface TaskPanelProps {
  currentLesson: string
  running: boolean
  busy: boolean
  progress: TaskProgressInfo | null
  history: TaskRowInfo[]
  onCreateRun: () => void
  onRetry: (taskId: string) => void
}

export function TaskPanel({
  currentLesson,
  running,
  busy,
  progress,
  history,
  onCreateRun,
  onRetry
}: TaskPanelProps): JSX.Element {
  const noLesson = currentLesson === ''
  return (
    <section class="task-panel">
      <h2>任务</h2>
      {noLesson ? (
        <EmptyState title="先选择课时" hint="从左侧课程树点击一个课时，即可创建并运行任务。" />
      ) : (
        <>
          <p class="msg">已选课时：{currentLesson}</p>
          <button class="btn primary" onClick={onCreateRun} disabled={running || busy}>
            {busy ? '提交中…' : running ? '运行中…' : '创建并运行'}
          </button>
          {progress != null && <TaskStatusCard progress={progress} />}
          <h3 class="subheading">本课时历史任务</h3>
          <HistoryList history={history} onRetry={onRetry} disabled={running} />
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
  return (
    <div class={`task-status${failed ? ' failed' : ''}`} data-testid="task-status">
      <div class="task-status-line">
        <span class="task-id">任务 {progress.taskId}</span>
        <span class="task-stage">{stageLabel(progress.state, progress.stage)}</span>
      </div>
      <ProgressBar percent={progress.percent} active={progress.state !== 'succeeded' && progress.state !== 'failed'} />
      {failed && <p class="task-error">{progress.message}</p>}
    </div>
  )
}

interface HistoryListProps {
  history: TaskRowInfo[]
  onRetry: (taskId: string) => void
  disabled: boolean
}

function HistoryList({ history, onRetry, disabled }: HistoryListProps): JSX.Element {
  if (history.length === 0) return <p class="msg">暂无任务</p>
  return (
    <div class="history-list">
      {history.map((row) => (
        <div key={row.id} class="item history-row">
          <span class="history-state">{stageLabel(row.state, row.failed_stage)}</span>
          {row.error_message != null && <span class="history-error">{row.error_message}</span>}
          {row.state === 'failed' && (
            <button class="btn small" onClick={() => onRetry(row.id)} disabled={disabled}>
              重试
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
