import { describe, expect, it, vi } from 'vitest'
import { TaskPanel } from '../../src/renderer/components/TaskPanel'
import { mount, click } from '../helpers/preact'
import type { TaskProgressInfo, TaskRowInfo } from '../../src/shared/bridge'

describe('TaskPanel', () => {
  it('shows an empty state when no lesson is selected', () => {
    const host = mount(
      <TaskPanel currentLesson="" running={false} busy={false} progress={null} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(host.textContent).toContain('先选择课时')
  })

  it('批2: the all-tasks view renders the live progress card (retry stays visible without a lesson)', () => {
    const progress: TaskProgressInfo = { taskId: 't1', state: 'transcribing', stage: 'transcribing', message: '转写中', percent: 42 }
    const row: TaskRowInfo = { ...ROW, id: 't1', state: 'transcribing' }
    const onCancel = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="" running busy={false} progress={progress} history={[]} globalHistory={[row]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={onCancel} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    // The exact gap the 2026-09-07 field report hit: retrying from the global
    // list left NO progress surface anywhere.
    expect(host.querySelector('[data-testid="task-status"]')).not.toBeNull()
    expect(host.textContent).toContain('转写音频')
    // 修复轮 1 (I1): 取消任务按钮同样必须无参调用（同上 MouseEvent 隐患）。
    const cancelBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '取消任务')
    click(cancelBtn ?? null)
    expect(onCancel).toHaveBeenCalledWith()
  })

  it('批2: the status card shows a percent readout, hidden while queued', () => {
    const running: TaskProgressInfo = { taskId: 't1', state: 'downloading_video', stage: 'downloading_video', message: '', percent: 35 }
    const queued: TaskProgressInfo = { taskId: 't2', state: 'pending', stage: null, message: '排队中', percent: 0 }
    const withPercent = mount(
      <TaskPanel currentLesson="" running busy={false} progress={running} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(withPercent.querySelector('.task-percent')?.textContent).toBe('35%')
    const queuedHost = mount(
      <TaskPanel currentLesson="" running busy={false} progress={queued} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(queuedHost.querySelector('.task-percent')).toBeNull()
  })

  it('批2: a queued row explains WHY 启动 is unavailable while the queue is busy', () => {
    const pending: TaskRowInfo = { ...ROW, id: 't-pending', state: 'pending' }
    const host = mount(
      <TaskPanel currentLesson="" running={false} busy={false} progress={null} history={[]} globalHistory={[pending]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const start = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '启动') as HTMLButtonElement
    expect(start).not.toBeNull()
    // Nothing is running here, so the button is enabled and invites the click.
    expect(start.disabled).toBe(false)
    expect(start.title).toContain('立即开始')
  })

  it('renders progress stage label, percent bar and error message on failure', () => {
    const progress: TaskProgressInfo = { taskId: 't1', state: 'failed', stage: 'transcribing', message: 'transcribe failed', percent: 57 }
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={progress} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(host.textContent).toContain('转写音频')
    expect(host.textContent).toContain('transcribe failed')
    const bar = host.querySelector<HTMLElement>('.progress-bar')
    expect(bar?.style.width).toBe('57%')
    expect(host.querySelector('.task-status.failed')).not.toBeNull()
  })

  it('offers queueing while a task runs instead of disabling (批3 B1)', () => {
    const progress: TaskProgressInfo = { taskId: 't2', state: 'summarizing', stage: 'summarizing', message: '生成笔记', percent: 83 }
    const host = mount(
      <TaskPanel currentLesson="l1" running busy={false} progress={progress} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const run = host.querySelector<HTMLButtonElement>('button.primary')
    expect(run?.disabled).toBe(false)
    expect(run?.textContent).toBe('排队下一节')
  })

  it('shows a queued task hint and a cancel-queue action (批3 B1)', () => {
    const progress: TaskProgressInfo = { taskId: 't3', state: 'pending', stage: null, message: '排队中', percent: 0 }
    const onCancel = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="l1" running busy={false} progress={progress} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={onCancel} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(host.textContent).toContain('排队中（等待当前任务完成）')
    const cancelQueue = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '取消排队')
    click(cancelQueue ?? null)
    expect(onCancel).toHaveBeenCalledOnce()
    // 修复轮 1 (I1): 无参调用——onClick={onCancel} 会把 MouseEvent 当 taskId 传进
    // App.cancelTask，event truthy → cancel(<MouseEvent>) → main assertSafeId 拒绝。
    expect(onCancel).toHaveBeenCalledWith()
  })

  it('wires the per-row cancel button for active tasks (批3 B5)', () => {
    const onCancel = vi.fn()
    const running: TaskRowInfo = { ...ROW, id: 't-running', state: 'transcribing' }
    const host = mount(
      <TaskPanel currentLesson="" running={false} busy={false} progress={null} history={[]} globalHistory={[running]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={onCancel} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const cancel = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '取消')
    click(cancel ?? null)
    expect(onCancel).toHaveBeenCalledWith('t-running')
  })

  it('fires onCreateRun when the create-and-run button is clicked', () => {
    const onCreateRun = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={[]} globalHistory={[]} onCreateRun={onCreateRun} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    click(host.querySelector('button.primary'))
    expect(onCreateRun).toHaveBeenCalledOnce()
  })

  const ROW: TaskRowInfo = {
    id: 't9',
    lesson_id: 'l1',
    state: 'succeeded',
    failed_stage: null,
    error_message: null,
    created_at: '2026-09-04T00:00:00Z',
    updated_at: '2026-09-04T00:10:00Z',
    course_name: '数据结构',
    lesson_title: '第1讲'
  }

  it('shows the readable lesson identity in the header chip instead of the raw id (批1 A3 → 批A chip)', () => {
    const host = mount(
      <TaskPanel currentLesson="1690625-L4" lessonContext={{ courseName: '数据结构', lessonTitle: '第4讲' }} running={false} busy={false} progress={null} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(host.querySelector('.lesson-chip-btn')?.textContent).toContain('数据结构')
    expect(host.querySelector('.lesson-chip-btn')?.textContent).toContain('第4讲')
    expect(host.textContent).not.toContain('1690625-L4')
  })

  it('hints at regenerate when the lesson already has a note (批1 B6)', () => {
    const withNote = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={[ROW]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(withNote.textContent).toContain('该课时已有笔记')
    expect(withNote.textContent).toContain('重新生成')
    const bare = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(bare.textContent).not.toContain('该课时已有笔记')
  })

  it('wires the per-row note button to onOpenNote (批1 A2)', () => {
    const onOpenNote = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="" running={false} busy={false} progress={null} history={[]} globalHistory={[ROW]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} onOpenNote={onOpenNote} />
    )
    const noteButton = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '笔记')
    expect(noteButton).not.toBeUndefined()
    click(noteButton ?? null)
    expect(onOpenNote).toHaveBeenCalledWith('l1')
  })

  it('annotates the progress card with the task lesson identity (批1 C1)', () => {
    const progress: TaskProgressInfo = { taskId: 't9', state: 'downloading_video', stage: 'downloading_video', message: '下载中', percent: 30 }
    const host = mount(
      <TaskPanel currentLesson="l1" running busy={false} progress={progress} history={[]} globalHistory={[ROW]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    expect(host.querySelector('.task-status-lesson')?.textContent).toBe('数据结构 · 第1讲')
  })

  it('renders failed history rows with a retry button wired to onRetry', () => {
    const history: TaskRowInfo[] = [
      { id: 't1', lesson_id: 'l1', state: 'failed', failed_stage: 'transcribing', error_message: 'boom' },
      { id: 't2', lesson_id: 'l1', state: 'succeeded', failed_stage: null, error_message: null }
    ]
    const onRetry = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={history} globalHistory={[]} onCreateRun={() => undefined} onRetry={onRetry} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const rows = host.querySelectorAll('.history-row')
    expect(rows).toHaveLength(2)
    const retry = host.querySelector<HTMLButtonElement>('.history-row button')
    expect(retry).not.toBeNull()
    click(retry)
    expect(onRetry).toHaveBeenCalledWith('t1')
  })

  it('批C: 任务列表被截断时标题说出总数与显示条数', () => {
    const history: TaskRowInfo[] = [
      { id: 't1', lesson_id: 'l1', state: 'succeeded', failed_stage: null, error_message: null, error_kind: null, course_name: '网络信息编程', lesson_title: '第五讲', teacher: null, courTimes: null, classroom: null }
    ]
    const host = mount(
      <TaskPanel currentLesson="" running={false} busy={false} progress={null} history={[]} globalHistory={history} globalHistoryTotal={88} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const heading = host.querySelector('.subheading')?.textContent ?? ''
    expect(heading).toContain('共 88 条')
    expect(heading).toContain('这里显示最近 1 条')
  })

  it('批C 批3: 任务列表没取完时给「显示更多」并回调', () => {
    const history: TaskRowInfo[] = [
      { id: 't1', lesson_id: 'l1', state: 'succeeded', failed_stage: null, error_message: null, error_kind: null, course_name: '网络信息编程', lesson_title: '第五讲', teacher: null, courTimes: null, classroom: null }
    ]
    const onMore = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="" running={false} busy={false} progress={null} history={[]} globalHistory={history} globalHistoryTotal={88} onMoreHistory={onMore} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const more = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('显示更多'))
    expect(more?.textContent).toContain('还有 87 条')
    click(more ?? null)
    expect(onMore).toHaveBeenCalled()
  })

  it('shows course/lesson names and humanized errors, and wires delete/clear (M1-2)', async () => {
    const history: TaskRowInfo[] = [
      { id: 't1', lesson_id: 'l1', state: 'failed', failed_stage: 'downloading_video', error_message: 'download failed: ERR_CONNECTION_RESET', error_kind: null, course_name: '网络信息编程', lesson_title: '第五讲', teacher: '汪海', courTimes: '周一 第3-4节', classroom: '中山-312' }
    ]
    const onDelete = vi.fn()
    const onClearFinished = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={history} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={onDelete} onClearFinished={onClearFinished} />
    )
    expect(host.querySelector('.history-lesson')?.textContent).toBe('网络信息编程 · 第五讲')
    // 批4 (T45): 被省略号截断的那串人话必须就是 tooltip——此前给的是平台 lesson_id。
    expect(host.querySelector('.history-lesson')?.getAttribute('title')).toBe('网络信息编程 · 第五讲')
    // F4: teacher / meeting-times / classroom secondary line.
    expect(host.querySelector('.history-meta')?.textContent).toBe('汪海 · 周一 第3-4节 · 中山-312')
    // Network code translated to user guidance; the tooltip carries the same
    // humanized wording in full (A8, plan 2026-09-13 — the raw code stays
    // reachable via «反馈这个错误» diagnostics, the tooltip now matches what
    // the row shows instead of exposing a different, more cryptic string).
    expect(host.querySelector('.history-error')?.textContent).toContain('网络连接被中断')
    expect(host.querySelector('.history-error')?.getAttribute('title')).toContain('网络连接被中断')
    click(host.querySelector<HTMLButtonElement>('.history-row button.ghost'))
    expect(onDelete).toHaveBeenCalledWith('t1')
    // M3 批 D: clear goes through the in-app Dialog, not window.confirm.
    click(host.querySelector<HTMLButtonElement>('.history-tools .btn'))
    await new Promise((r) => setTimeout(r, 10))
    click(host.querySelector('.dialog .btn.danger'))
    await new Promise((r) => setTimeout(r, 10))
    expect(onClearFinished).toHaveBeenCalledOnce()
  })

  // 批3 (P22/D11) 验收项的渲染半边（批3 二次评审点名）：话术单测与渲染路径是两回事
  // ——此前的任务行用例只喂过 ERR_CONNECTION_RESET，超时原文从未经过任务行。
  it('批3 (P22): 生成侧超时原文在任务行显示新话术（指向换模型/缩短视频/少发图）', () => {
    const history: TaskRowInfo[] = [
      {
        id: 't1',
        lesson_id: 'l1',
        state: 'failed',
        failed_stage: 'summarizing',
        // provider 侧 10 分钟上限撞墙时的原始信息（openai-client 的 CHAT_TIMEOUT_MS）。
        error_message: 'The operation was aborted due to timeout',
        error_kind: null,
        course_name: '数据结构',
        lesson_title: '第五讲',
        teacher: '汪海',
        courTimes: '周一 第3-4节',
        classroom: '中山-312'
      }
    ]
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={history} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const err = host.querySelector('.history-error')
    expect(err?.textContent).toContain('10 分钟上限')
    expect(err?.textContent).toContain('换更快的模型')
    expect(err?.textContent).toContain('缩短视频')
    expect(err?.textContent).toContain('少发图片')
    // 旧话术把用户引向代理与 DNS——它不该出现在生成超时上。
    expect(err?.textContent).not.toContain('服务暂不可用')
    // 行与 tooltip 同一句（A8 的既有口径）。
    expect(err?.getAttribute('title')).toBe(err?.textContent)
  })

  it('filters rows by state chips (M1-2)', () => {
    const history: TaskRowInfo[] = [
      { id: 't1', lesson_id: 'l1', state: 'succeeded', failed_stage: null, error_message: null },
      { id: 't2', lesson_id: 'l1', state: 'failed', failed_stage: 'summarizing', error_message: null }
    ]
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={history} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const failedChip = [...host.querySelectorAll('.chip')].find((c) => c.textContent === '失败/取消') ?? null
    click(failedChip)
    const rows = host.querySelectorAll('.history-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('败')
  })

  it('stamps one-character ink seals: 成 / 停 / 败 (V3)', () => {
    const history: TaskRowInfo[] = [
      { id: 't1', lesson_id: 'l1', state: 'succeeded', failed_stage: null, error_message: null },
      { id: 't2', lesson_id: 'l1', state: 'failed', failed_stage: 'downloading_video', error_message: 'x', error_kind: 'cancelled' },
      { id: 't3', lesson_id: 'l1', state: 'failed', failed_stage: 'transcribing', error_message: 'y', error_kind: 'network' }
    ]
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={history} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const seals = [...host.querySelectorAll('.history-state')].map((s) => s.textContent)
    expect(seals).toEqual(['成', '停', '败'])
  })

  it('批4: 行级取消 IPC 在途时该行按钮 disabled，连点不出第二个 IPC', async () => {
    let releaseCancel!: () => void
    const cancelGate = new Promise<void>((r) => {
      releaseCancel = r
    })
    const onCancel = vi.fn(() => cancelGate)
    const running: TaskRowInfo = { ...ROW, id: 't-running', state: 'transcribing' }
    const host = mount(
      <TaskPanel currentLesson="" running={false} busy={false} progress={null} history={[]} globalHistory={[running]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={onCancel} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const cancel = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '取消') as HTMLButtonElement
    click(cancel)
    await new Promise((r) => setTimeout(r, 10))
    expect(onCancel).toHaveBeenCalledTimes(1)
    // AGENTS.md busy 约定：IPC 在途期间按钮置灰，防止连点发出第二个 cancel。
    expect(cancel.disabled).toBe(true)
    click(cancel)
    await new Promise((r) => setTimeout(r, 10))
    expect(onCancel).toHaveBeenCalledTimes(1)
    releaseCancel()
    await new Promise((r) => setTimeout(r, 10))
    // IPC 落定：按钮恢复可用（行数据本身的刷新由父层负责）。
    expect(cancel.disabled).toBe(false)
  })
})

/**
 * 批6 (H21, plan 2026-09-28): 任务面板剩下的 busy 纪律缺口——TaskStatusCard 的
 * 「取消任务 / 取消排队」此前没有任何在途态（连点会打第二次 tasks.cancel），
 * 全局历史的「显示更多」同 tick 连点会让 limit 一次跳两页（打两次 IPC）。
 */
describe('TaskPanel 批6 H21: 取消与显示更多的在途态', () => {
  // 模块级 describe 拿不到上面嵌套 describe 里的 ROW，这里自备一份同形夹具。
  const ROW: TaskRowInfo = {
    id: 't9',
    lesson_id: 'l1',
    state: 'succeeded',
    failed_stage: null,
    error_message: null,
    created_at: '2026-09-04T00:00:00Z',
    updated_at: '2026-09-04T00:10:00Z',
    course_name: '数据结构',
    lesson_title: '第1讲'
  }
  const baseProps = {
    currentLesson: '',
    running: false,
    busy: false,
    progress: null,
    history: [],
    globalHistory: [],
    onCreateRun: () => undefined,
    onRetry: () => undefined,
    onCancel: () => undefined,
    onDelete: () => undefined,
    onClearFinished: () => undefined
  }

  it('取消任务在途时按钮读「取消中…」并禁用，同 tick 连点只发一次 IPC', async () => {
    const gate: { settle?: () => void } = {}
    const onCancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          gate.settle = resolve
        })
    )
    const progress: TaskProgressInfo = { taskId: 't1', state: 'transcribing', stage: 'transcribing', message: '转写中', percent: 10 }
    const row: TaskRowInfo = { ...ROW, id: 't1', state: 'transcribing' }
    const host = mount(<TaskPanel {...baseProps} running progress={progress} globalHistory={[row]} onCancel={onCancel} />)
    const cancelBtn = (): HTMLButtonElement | null =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === '取消任务' || b.textContent === '取消中…') ?? null
    click(cancelBtn())
    click(cancelBtn())
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    expect(cancelBtn()?.textContent).toBe('取消中…')
    expect(cancelBtn()?.disabled).toBe(true)
    gate.settle?.()
    await vi.waitFor(() => expect(cancelBtn()?.textContent).toBe('取消任务'))
    expect(cancelBtn()?.disabled).toBe(false)
  })

  it('取消排队在途时同样禁用，只发一次 IPC', async () => {
    const gate: { settle?: () => void } = {}
    const onCancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          gate.settle = resolve
        })
    )
    const progress: TaskProgressInfo = { taskId: 't2', state: 'pending', stage: null, message: '排队中', percent: 0 }
    const host = mount(<TaskPanel {...baseProps} running progress={progress} onCancel={onCancel} />)
    const cancelQueue = (): HTMLButtonElement | null =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === '取消排队' || b.textContent === '取消中…') ?? null
    click(cancelQueue())
    click(cancelQueue())
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    expect(cancelQueue()?.textContent).toBe('取消中…')
    expect(cancelQueue()?.disabled).toBe(true)
    gate.settle?.()
    await vi.waitFor(() => expect(cancelQueue()?.disabled).toBe(false))
  })

  it('「显示更多」同 tick 连点只回调一次（limit 不跳两页）', () => {
    const onMore = vi.fn()
    const history: TaskRowInfo[] = Array.from({ length: 3 }, (_, i) => ({ ...ROW, id: `t${i}`, state: 'succeeded' }))
    const host = mount(
      <TaskPanel {...baseProps} globalHistory={history} globalHistoryTotal={88} onMoreHistory={onMore} />
    )
    const more = (): HTMLButtonElement | null =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('显示更多') || b.textContent === '加载中…') ?? null
    click(more())
    click(more())
    expect(onMore).toHaveBeenCalledTimes(1)
    expect(more()?.textContent).toBe('加载中…')
    expect(more()?.disabled).toBe(true)
  })
})
