/**
 * Tasks domain (批8, plan 2026-09-19 D5): task create/run/cancel/remove +
 * lesson history + global history + live progress. The progress
 * subscription and the mount-time resume stay in the app shell (they fan
 * out to other domains); this hook owns the task state and task callbacks.
 */
import { useCallback, useRef, useState } from 'preact/hooks'
import type { ProvidersListResult, SeuSummaryBridge, TaskProgressInfo, TaskRowInfo } from '../../shared/bridge'
import type { Toast } from './use-config-domain'

/** 批C 批3: 分页步长（「显示更多」每次加一页）。 */
const TASK_PAGE = 50

/** True while the task still belongs to the serial queue. */
export function isActiveState(state: string): boolean {
  return state !== 'succeeded' && state !== 'failed'
}

export interface TasksDomain {
    showMoreTasks: () => void
    history: TaskRowInfo[]
    /** Recent tasks across all lessons (serial queue visibility). */
    globalHistory: TaskRowInfo[]
    globalHistoryTotal: number
    progress: TaskProgressInfo | null
    running: boolean
    submitBusy: boolean
    /** A1: create + run with a pre-flight capability check. */
    createAndRun: () => void
    retryTask: (taskId: string) => void
    /** 批4: 返回 Promise——TaskPanel 行级按钮据此在 IPC 在途期间置灰。 */
    cancelTask: (taskId?: string) => Promise<void>
    /** 批4: 返回 Promise——TaskPanel 行级按钮据此在 IPC 在途期间置灰。 */
    removeTask: (taskId: string) => Promise<void>
    clearFinishedTasks: () => void

  /** B站导入多P 经此启动第一个（排队中不弹进度卡）。 */
  launch: (taskId: string, queued: boolean) => Promise<void>
  loadHistory: (lessonId: string) => Promise<void>
  loadGlobalHistory: () => Promise<TaskRowInfo[]>
  /** 挂载恢复与 progress 订阅在 app shell，经这两个 setter 推进本域状态。 */
  setProgress: (p: TaskProgressInfo | null) => void
  setRunning: (running: boolean) => void
  /** 换课/退出登录时清掉本域残留（lesson 级 history）。 */
  clearLessonData: () => void
}

export interface TasksDomainDeps {
  lessonRef: { current: string }
  currentLesson: string
  providers: ProvidersListResult | null
  goSettings: () => void
}

export function useTasksDomain(bridge: SeuSummaryBridge, toast: Toast, deps: TasksDomainDeps): TasksDomain {
  const { lessonRef, currentLesson, providers, goSettings } = deps

  const [taskLimit, setTaskLimit] = useState(TASK_PAGE)

  const taskLimitRef = useRef(TASK_PAGE)
  taskLimitRef.current = taskLimit

  const [history, setHistory] = useState<TaskRowInfo[]>([])
  const [globalHistory, setGlobalHistory] = useState<TaskRowInfo[]>([])
  const [globalHistoryTotal, setGlobalHistoryTotal] = useState(0)
  const [progress, setProgress] = useState<TaskProgressInfo | null>(null)
  const [running, setRunning] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)

  const loadHistory = useCallback(async (lessonId: string): Promise<void> => {
    const res = await bridge.tasks.list(lessonId)
    if (res.ok && res.value != null && lessonRef.current === lessonId) setHistory(res.value.items)
  }, [bridge])

  const loadGlobalHistory = useCallback(async (): Promise<TaskRowInfo[]> => {
    const res = await bridge.tasks.list(undefined, { limit: taskLimitRef.current })
    if (res.ok && res.value != null) {
      setGlobalHistory(res.value.items)
      setGlobalHistoryTotal(res.value.total)
      return res.value.items
    }
    return []
  }, [bridge])

  const launch = useCallback(
    async (taskId: string, queued: boolean): Promise<void> => {
      // B1: a queued task gets no progress card yet — the serial queue will
      // push progress events when its turn comes.
      if (!queued) {
        setProgress({ taskId, state: 'pending', stage: null, message: '排队中', percent: 0 })
        setRunning(true)
      }
      const res = await bridge.tasks.runAsync(taskId)
      if (!res.ok) {
        if (!queued) setRunning(false)
        toast(res.error ?? '启动失败', 'error')
      }
    },
    [bridge, toast]
  )

  /** B1: how many tasks are queued/running right now (from the latest rows). */
  const countActive = useCallback((): number => {
    return globalHistory.filter((row) => isActiveState(row.state)).length
  }, [globalHistory])

  const createAndRun = useCallback((): void => {
    if (currentLesson === '' || submitBusy) return
    // A1: validate capability bindings BEFORE creating the task — a missing
    // binding used to surface only at the summarizing stage (30+ min lost).
    const caps = new Set((providers?.bindings ?? []).map((b) => b.capability))
    const missing: string[] = []
    if (!caps.has('asr')) missing.push('ASR 转写')
    if (!caps.has('multimodal')) missing.push('多模态总结')
    if (missing.length > 0) {
      toast(`尚未绑定${missing.join('、')}模型，任务无法完成。请先在设置中配置 Provider。`, 'error', {
        actionLabel: '去设置',
        onAction: goSettings
      })
      return
    }
    // B1: queueing is allowed while a task runs — bounded, and one task per
    // lesson so the same video is never downloaded twice in parallel.
    const queued = running
    const activeCount = countActive()
    if (queued && activeCount >= 3) {
      toast('已有 3 个任务在排队/运行，等一个完成再排吧', 'error')
      return
    }
    if (globalHistory.some((row) => row.lesson_id === currentLesson && isActiveState(row.state))) {
      toast('该课时已有任务在排队/运行中', 'error')
      return
    }
    void (async () => {
      setSubmitBusy(true)
      try {
        const created = await bridge.tasks.create(currentLesson)
        if (!created.ok) {
          toast(created.error ?? '创建任务失败', 'error')
          return
        }
        await launch((created.value as { id: string }).id, queued)
        if (queued) {
          toast('已加入队列，当前任务完成后自动开始', 'success')
          await loadGlobalHistory()
        }
      } finally {
        setSubmitBusy(false)
      }
    })()
  }, [bridge, currentLesson, running, submitBusy, providers, toast, goSettings, launch, countActive, globalHistory, loadGlobalHistory])

  const retryTask = useCallback(
    (taskId: string): void => {
      if (running) return
      void launch(taskId, false)
    },
    [running, launch]
  )

  /** B5: cancel any queued/running task by id (row-level button too). */
  const cancelTask = useCallback(
    (taskId?: string): Promise<void> => {
      const id = taskId ?? (running ? progress?.taskId : undefined)
      if (id == null) return Promise.resolve()
      return (async () => {
        const res = await bridge.tasks.cancel(id)
        if (!res.ok) {
          toast(res.error ?? '取消失败', 'error')
          return
        }
        await loadGlobalHistory()
        const lid = lessonRef.current
        if (lid !== '') void loadHistory(lid)
      })()
    },
    [bridge, running, progress, toast, loadGlobalHistory, loadHistory]
  )

  // M1-2: delete one terminal history row / clear all terminal rows, then
  // refresh the visible histories.
  const removeTask = useCallback(
    (taskId: string): Promise<void> => {
      return (async () => {
        const res = await bridge.tasks.remove(taskId)
        if (!res.ok) {
          toast(res.error ?? '删除失败', 'error')
          return
        }
        await loadGlobalHistory()
        const lid = lessonRef.current
        if (lid !== '') void loadHistory(lid)
      })()
    },
    [bridge, toast, loadGlobalHistory, loadHistory]
  )

  const clearFinishedTasks = useCallback((): void => {
    void (async () => {
      const res = await bridge.tasks.clearFinished()
      if (!res.ok) {
        toast(res.error ?? '清理失败', 'error')
        return
      }
      toast(`已清理 ${res.value?.removed ?? 0} 条任务记录`, 'success')
      await loadGlobalHistory()
      const lid = lessonRef.current
      if (lid !== '') void loadHistory(lid)
    })()
  }, [bridge, toast, loadGlobalHistory, loadHistory])


  const clearLessonData = useCallback((): void => {
    setHistory([])
  }, [])

  return {
    history,
    globalHistory,
    globalHistoryTotal,
    progress,
    running,
    submitBusy,
    showMoreTasks: () => setTaskLimit((n) => n + TASK_PAGE),
    loadHistory,
    loadGlobalHistory,
    launch,
    createAndRun,
    retryTask,
    cancelTask,
    removeTask,
    clearFinishedTasks,
    setProgress,
    setRunning,
    clearLessonData
  }
}
