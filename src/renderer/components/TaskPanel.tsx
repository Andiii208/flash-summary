import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { AudioLines, BookOpenCheck, CloudDownload, Download, Images, ScrollText, X } from 'lucide-preact'
import type { LucideIcon } from 'lucide-preact'
import type { TaskProgressInfo, TaskRowInfo } from '../../shared/bridge'
import { humanizeTaskError } from '../../shared/errors'
import { PIPELINE_STAGES, STAGE_LABELS, stageLabel } from '../labels'
import { ProgressBar } from './ProgressBar'
import { EmptyState } from './EmptyState'
import { PageHeader } from './PageHeader'
import { LessonChip, type LessonChipLesson } from './LessonChip'
import { Dialog } from '../ui/Dialog'

export interface TaskPanelProps {
  currentLesson: string
  /** 批A: identity of the selection for the header chip (null = none picked). */
  lessonContext?: { courseName: string; lessonTitle: string } | null
  /** 批A: sibling lessons for the chip's quick-switch dropdown. */
  lessonOptions?: LessonChipLesson[]
  /** 批A: chip dropdown selection — switches lesson, keeps the tasks tab. */
  onSelectLesson?: (lessonId: string) => void
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
  /** A2: open a finished task's note (selects the lesson + switches tab). */
  onOpenNote?: (lessonId: string) => void
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

/** F4: 教师 · 上课时间 · 教室 secondary line (whatever the course row has). */
function taskMetaLine(row: TaskRowInfo): string | null {
  const parts = [row.teacher, row.courTimes, row.classroom].filter((p): p is string => p != null && p !== '')
  return parts.length > 0 ? parts.join(' · ') : null
}

export function TaskPanel({
  currentLesson,
  lessonContext = null,
  lessonOptions,
  onSelectLesson,
  running,
  busy,
  progress,
  history,
  globalHistory,
  onCreateRun,
  onRetry,
  onCancel,
  onDelete,
  onClearFinished,
  onOpenNote
}: TaskPanelProps): JSX.Element {
  const noLesson = currentLesson === ''
  const hasNoteAlready = history.some((row) => row.state === 'succeeded')
  const chip =
    lessonContext != null ? (
      <LessonChip
        courseName={lessonContext.courseName}
        lessonTitle={lessonContext.lessonTitle}
        lessons={lessonOptions}
        currentLessonId={currentLesson}
        onSelectLesson={onSelectLesson}
      />
    ) : undefined
  return (
    <section class="task-panel">
      <PageHeader title="任务" chip={chip} />
      {noLesson ? (
        <>
          <EmptyState
            title="先选择课时"
            hint="从左侧课程树点击一个课时即可创建任务；B站视频用侧栏「导入 B站视频」添加。"
          />
          {/* 批2: 全部任务视图同样渲染进度卡——重试/排队中的任务在任何视图都可见，
              不再只在选中课时后才有进度（2026-09-07 用户实测实锤的断层）。 */}
          {progress != null && (
            <TaskStatusCard
              progress={progress}
              taskRow={globalHistory.find((row) => row.id === progress.taskId)}
              onCancel={onCancel}
              cancellable={running}
            />
          )}
          <h3 class="subheading">全部任务（最近 50 条）</h3>
          <HistoryList
            history={globalHistory}
            onRetry={onRetry}
            disabled={running}
            onCancel={onCancel}
            onDelete={onDelete}
            onClearFinished={onClearFinished}
            onOpenNote={onOpenNote}
          />
        </>
      ) : (
        <>
          {/* B1: queueing is allowed while another task runs. */}
          <button class="btn primary" onClick={onCreateRun} disabled={busy}>
            {busy ? '提交中…' : running ? '排队下一节' : '创建并运行'}
          </button>
          {running && (
            <button class="btn danger" onClick={onCancel} disabled={busy}>
              取消任务
            </button>
          )}
          {hasNoteAlready && !running && (
            <p class="msg rerun-hint">该课时已有笔记：只更新内容可在「笔记」页用重新生成；重新运行将重新下载并处理整节课。</p>
          )}
          {progress != null && (
            <TaskStatusCard
              progress={progress}
              taskRow={globalHistory.find((row) => row.id === progress.taskId)}
              onCancel={onCancel}
              cancellable={running}
            />
          )}
          <h3 class="subheading">本课时历史任务</h3>
          <HistoryList
            history={history}
            onRetry={onRetry}
            disabled={running}
            onCancel={onCancel}
            onDelete={onDelete}
            onClearFinished={onClearFinished}
            onOpenNote={onOpenNote}
          />
        </>
      )}
    </section>
  )
}

interface TaskStatusCardProps {
  progress: TaskProgressInfo
  /** C1: the task row (course · lesson identity) when resolvable. */
  taskRow?: TaskRowInfo
  /** B1: a queued task shows a badge instead of the progress card. */
  cancellable?: boolean
  onCancel?: () => void
}

/** V3 印章轴: one lucide glyph per pipeline stage (rail instrument icons). */
const STAGE_ICONS: Record<string, LucideIcon> = {
  fetching_course: CloudDownload,
  downloading_video: Download,
  extracting_audio: AudioLines,
  transcribing: ScrollText,
  extracting_visuals: Images,
  summarizing: BookOpenCheck
}

/** V3 墨章: one-character status seal per task state (cancelled gets 停). */
function sealFor(row: Pick<TaskRowInfo, 'state' | 'error_kind'>): { char: string; seal: string } {
  if (row.state === 'succeeded') return { char: '成', seal: 'ok' }
  if (row.state === 'failed') return row.error_kind === 'cancelled' ? { char: '停', seal: 'stop' } : { char: '败', seal: 'bad' }
  return { char: '行', seal: 'run' }
}

function TaskStatusCard({ progress, taskRow, cancellable = false, onCancel }: TaskStatusCardProps): JSX.Element {
  const failed = progress.state === 'failed'
  const succeeded = progress.state === 'succeeded'
  // Position of the furthest reached stage on the rail.
  const reached = succeeded
    ? PIPELINE_STAGES.length
    : Math.max(0, PIPELINE_STAGES.indexOf((progress.stage ?? progress.state) as (typeof PIPELINE_STAGES)[number]))
  const queued = progress.state === 'pending' && !succeeded && !failed
  return (
    <div class={`task-status${failed ? ' failed' : ''}`} data-testid="task-status">
      <div class="task-status-line">
        <span class="task-id">任务 {progress.taskId}</span>
        <span class={`task-stage${succeeded ? ' done' : ''}`}>
          {queued ? '排队中（等待当前任务完成）' : stageLabel(progress.state, progress.stage)}
        </span>
      </div>
      {taskRow != null && (
        <p class="task-status-lesson" title={taskRow.lesson_id}>
          {taskLabel(taskRow)}
        </p>
      )}
      <div class="stage-rail">
        {PIPELINE_STAGES.map((stage, i) => {
          const cls = i < reached ? 'done' : i === reached ? (failed ? 'error' : 'active') : 'todo'
          const Icon = STAGE_ICONS[stage]
          return (
            <div key={stage} class={`stage-step ${cls}`} title={STAGE_LABELS[stage]}>
              <span class="stage-dot">{Icon != null ? <Icon size={11} strokeWidth={2} /> : null}</span>
              <span class="stage-name">{STAGE_LABELS[stage]}</span>
            </div>
          )
        })}
      </div>
      <div class="task-progress-row">
        <ProgressBar percent={progress.percent} active={!succeeded && !failed} />
        {/* 批2: 百分比读数——长任务需要可量化的进度感；排队中没有意义，不显示。 */}
        {!queued && <span class="task-percent">{Math.round(progress.percent)}%</span>}
      </div>
      {progress.detail != null && <p class="task-detail">{progress.detail}</p>}
      {failed && <p class="task-error">{progress.message}</p>}
      {cancellable && !queued && onCancel != null && (
        <button class="btn small danger" onClick={onCancel}>
          取消任务
        </button>
      )}
      {queued && onCancel != null && (
        <button class="btn small ghost" onClick={onCancel}>
          取消排队
        </button>
      )}
    </div>
  )
}

interface HistoryListProps {
  history: TaskRowInfo[]
  onRetry: (taskId: string) => void
  disabled: boolean
  onCancel: (taskId: string) => void
  onDelete: (taskId: string) => void
  onClearFinished: () => void
  /** A2: open a finished task's note. */
  onOpenNote?: (lessonId: string) => void
}

function HistoryList({ history, onRetry, disabled, onCancel, onDelete, onClearFinished, onOpenNote }: HistoryListProps): JSX.Element {
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
      {visible.map((row) => {
        const meta = taskMetaLine(row)
        return (
          <div key={row.id} class="item history-row">
            {(() => {
              const { char, seal } = sealFor(row)
              return (
                <span class={`history-state seal-${seal}`} title={stageLabel(row.state, row.failed_stage)}>
                  {char}
                </span>
              )
            })()}
            <div class="history-label">
              <span class="history-lesson" title={row.lesson_id}>
                {taskLabel(row)}
              </span>
              {meta != null && <span class="history-meta">{meta}</span>}
            </div>
            {row.error_message != null && (
              <span class="history-error" title={row.error_message}>
                {humanizeTaskError(row.error_message, row.error_kind)}
              </span>
            )}
            {row.state === 'succeeded' && onOpenNote != null && (
              <button class="btn small" onClick={() => onOpenNote(row.lesson_id)} title="查看这节课的笔记">
                笔记
              </button>
            )}
            {row.state === 'pending' && (
              <button
                class="btn small"
                onClick={() => onRetry(row.id)}
                disabled={disabled}
                title={disabled ? '队列忙碌，轮到它会自动开始' : '立即开始这个任务'}
              >
                启动
              </button>
            )}
            {row.state !== 'succeeded' && row.state !== 'failed' && (
              <button class="btn small danger" onClick={() => onCancel(row.id)} title="取消这个任务">
                取消
              </button>
            )}
            {row.state === 'failed' && (
              <button class="btn small" onClick={() => onRetry(row.id)} disabled={disabled}>
                重试
              </button>
            )}
            {(row.state === 'succeeded' || row.state === 'failed') && (
              <button class="btn small ghost" title="删除这条记录" aria-label="删除这条记录" onClick={() => onDelete(row.id)}>
                <X size={13} strokeWidth={1.75} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
