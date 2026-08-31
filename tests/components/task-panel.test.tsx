import { describe, expect, it, vi } from 'vitest'
import { TaskPanel } from '../../src/renderer/components/TaskPanel'
import { mount, click } from '../helpers/preact'
import type { TaskProgressInfo, TaskRowInfo } from '../../src/shared/bridge'

describe('TaskPanel', () => {
  it('shows an empty state when no lesson is selected', () => {
    const host = mount(
      <TaskPanel currentLesson="" running={false} busy={false} progress={null} history={[]} onCreateRun={() => undefined} onRetry={() => undefined} />
    )
    expect(host.textContent).toContain('先选择课时')
  })

  it('renders progress stage label, percent bar and error message on failure', () => {
    const progress: TaskProgressInfo = { taskId: 't1', state: 'failed', stage: 'transcribing', message: 'transcribe failed', percent: 57 }
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={progress} history={[]} onCreateRun={() => undefined} onRetry={() => undefined} />
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
      <TaskPanel currentLesson="l1" running busy={false} progress={progress} history={[]} onCreateRun={() => undefined} onRetry={() => undefined} />
    )
    const run = host.querySelector<HTMLButtonElement>('button.primary')
    expect(run?.disabled).toBe(true)
    expect(run?.textContent).toBe('运行中…')
  })

  it('fires onCreateRun when the create-and-run button is clicked', () => {
    const onCreateRun = vi.fn()
    const host = mount(
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={[]} onCreateRun={onCreateRun} onRetry={() => undefined} />
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
      <TaskPanel currentLesson="l1" running={false} busy={false} progress={null} history={history} onCreateRun={() => undefined} onRetry={onRetry} />
    )
    const rows = host.querySelectorAll('.history-row')
    expect(rows).toHaveLength(2)
    const retry = host.querySelector<HTMLButtonElement>('.history-row button')
    expect(retry).not.toBeNull()
    click(retry)
    expect(onRetry).toHaveBeenCalledWith('t1')
  })
})
