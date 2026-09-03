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

  it('disables the run button while running and shows progress state', () => {
    const progress: TaskProgressInfo = { taskId: 't2', state: 'summarizing', stage: 'summarizing', message: '生成笔记', percent: 83 }
    const host = mount(
      <TaskPanel currentLesson="l1" running busy={false} progress={progress} history={[]} globalHistory={[]} onCreateRun={() => undefined} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    const run = host.querySelector<HTMLButtonElement>('button.primary')
    expect(run?.disabled).toBe(true)
    expect(run?.textContent).toBe('运行中…')
  })

  it('fires onCreateRun when the create-and-run button is clicked', () => {
    const onCreateRun = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={[]} globalHistory={[]} onCreateRun={onCreateRun} onRetry={() => undefined} onCancel={() => undefined} onDelete={() => undefined} onClearFinished={() => undefined} />
    )
    click(host.querySelector('button.primary'))
    expect(onCreateRun).toHaveBeenCalledOnce()
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
    expect(rows[0]!.textContent).toContain('失败')
  })
})
