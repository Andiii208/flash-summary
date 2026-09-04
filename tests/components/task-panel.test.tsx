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
    // F4: teacher / meeting-times / classroom secondary line.
    expect(host.querySelector('.history-meta')?.textContent).toBe('汪海 · 周一 第3-4节 · 中山-312')
    // Network code translated to user guidance; raw text kept in tooltip.
    expect(host.querySelector('.history-error')?.textContent).toContain('网络连接被中断')
    expect(host.querySelector('.history-error')?.getAttribute('title')).toContain('ERR_CONNECTION_RESET')
    click(host.querySelector<HTMLButtonElement>('.history-row button.ghost'))
    expect(onDelete).toHaveBeenCalledWith('t1')
    // M3 批 D: clear goes through the in-app Dialog, not window.confirm.
    click(host.querySelector<HTMLButtonElement>('.history-tools .btn'))
    await new Promise((r) => setTimeout(r, 10))
    click(host.querySelector('.dialog .btn.danger'))
    await new Promise((r) => setTimeout(r, 10))
    expect(onClearFinished).toHaveBeenCalledOnce()
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
})
