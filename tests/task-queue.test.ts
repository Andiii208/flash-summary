import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { TaskRepository, runTask, type StageExecutor, type TaskProgress } from '../src/main/tasks/queue'
import type { StageResult } from '../src/main/tasks/stages'
import { PIPELINE_STAGES, canTransition, stagePercent, type Stage } from '../src/main/tasks/stages'

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-queue-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function executorsThatFailAt(failAt: Stage | '__never__'): { executors: Record<Stage, StageExecutor>; calls: Stage[] } {
  const calls: Stage[] = []
  const executors = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [
      stage,
      (ctx: { stage: Stage }): StageResult => {
        void ctx
        calls.push(stage)
        if (stage === failAt) return { status: 'failed', error: `boom at ${stage}` }
        return { status: 'ok' }
      }
    ])
  ) as unknown as Record<Stage, StageExecutor>
  return { executors, calls }
}

describe('state machine transitions', () => {
  it('walks the spec pipeline in order', () => {
    expect(PIPELINE_STAGES).toEqual([
      'fetching_course',
      'downloading_video',
      'extracting_audio',
      'transcribing',
      'extracting_visuals',
      'summarizing'
    ])
  })

  it('allows only forward one-step transitions from stages', () => {
    expect(canTransition('pending', 'fetching_course')).toBe(true)
    expect(canTransition('fetching_course', 'downloading_video')).toBe(true)
    expect(canTransition('downloading_video', 'transcribing')).toBe(false)
    expect(canTransition('succeeded', 'fetching_course')).toBe(false)
  })
})

describe('runTask with failure injection', () => {
  it('runs all stages and succeeds', async () => {
    const repo = new TaskRepository(db)
    repo.create('t1', 'l1')
    const { executors, calls } = executorsThatFailAt('__never__')

    const result = await runTask(repo, 't1', executors, 'fetching_course')
    expect(result).toBe('succeeded')
    expect(calls).toEqual([...PIPELINE_STAGES])
    expect(repo.get('t1')?.state).toBe('succeeded')
  })

  it('fails at the injected stage and records the failed stage', async () => {
    const repo = new TaskRepository(db)
    repo.create('t2', 'l1')
    const { executors, calls } = executorsThatFailAt('transcribing')

    const result = await runTask(repo, 't2', executors, 'fetching_course')
    expect(result).toBe('failed')
    expect(calls).toEqual(['fetching_course', 'downloading_video', 'extracting_audio', 'transcribing'])
    const row = repo.get('t2')!
    expect(row.state).toBe('failed')
    expect(row.failed_stage).toBe('transcribing')
    expect(row.error_message).toContain('transcribing')
  })
})

describe('resuming from a failed stage does not redo completed stages', () => {
  it('first run fails at transcribing; a resume re-runs only transcribing onwards', async () => {
    const repo = new TaskRepository(db)
    repo.create('t3', 'l1')

    // First attempt: fail at transcribing.
    const first = executorsThatFailAt('transcribing')
    await runTask(repo, 't3', first.executors, 'fetching_course')
    expect(first.calls).toEqual(['fetching_course', 'downloading_video', 'extracting_audio', 'transcribing'])

    // Resume attempt (what a retry does): only the failed stage and later run.
    const second = executorsThatFailAt('__never__')
    const result = await runTask(repo, 't3', second.executors, 'transcribing')

    expect(result).toBe('succeeded')
    expect(second.calls).toEqual(['transcribing', 'extracting_visuals', 'summarizing'])
    expect(second.calls).not.toContain('fetching_course')
    expect(second.calls).not.toContain('downloading_video')
    expect(second.calls).not.toContain('extracting_audio')
    expect(repo.get('t3')?.state).toBe('succeeded')
  })
})

describe('U1: progress events and stage percent', () => {
  it('stagePercent maps each stage to a monotonically increasing percent', () => {
    const percents = PIPELINE_STAGES.map((s) => stagePercent(s))
    expect(percents[0]).toBeGreaterThan(0)
    expect(percents[percents.length - 1]).toBe(100)
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThan(percents[i - 1])
    }
  })

  it('runTask emits a progress event for every stage and one for success', async () => {
    const repo = new TaskRepository(db)
    repo.create('p1', 'l1')
    const { executors } = executorsThatFailAt('__never__')
    const events: TaskProgress[] = []
    const result = await runTask(repo, 'p1', executors, 'fetching_course', (p) => events.push(p))
    expect(result).toBe('succeeded')
    // one event per stage + final succeeded
    expect(events).toHaveLength(PIPELINE_STAGES.length + 1)
    expect(events.map((e) => e.state)).toEqual([...PIPELINE_STAGES, 'succeeded'])
    expect(events[0].taskId).toBe('p1')
    expect(events[events.length - 1].percent).toBe(100)
    // percentages grow through the stages
    for (let i = 1; i < PIPELINE_STAGES.length; i++) {
      expect(events[i].percent).toBeGreaterThan(events[i - 1].percent)
    }
  })

  it('a stage-START event carries the previous stage percent, not its own (review D8)', async () => {
    const repo = new TaskRepository(db)
    repo.create('p5', 'l1')
    const { executors } = executorsThatFailAt('__never__')
    const events: TaskProgress[] = []
    await runTask(repo, 'p5', executors, 'fetching_course', (p) => events.push(p))
    // The first stage starts at 0 (it used to claim its own completion percent).
    expect(events[0].percent).toBe(0)
    for (let i = 1; i < PIPELINE_STAGES.length; i++) {
      expect(events[i].percent).toBe(stagePercent(PIPELINE_STAGES[i - 1] as Stage))
    }
  })

  it('runTask marks a session_expired failure with kind so the UI can offer re-login', async () => {
    const repo = new TaskRepository(db)
    repo.create('p2', 'l1')
    const events: TaskProgress[] = []
    const executors = Object.fromEntries(
      PIPELINE_STAGES.map((stage) => [
        stage,
        (): StageResult =>
          stage === 'fetching_course'
            ? { status: 'failed', error: 'school session expired (redirect to CAS)', kind: 'session_expired' }
            : { status: 'ok' }
      ])
    ) as unknown as Record<Stage, StageExecutor>

    const result = await runTask(repo, 'p2', executors, 'fetching_course', (p) => events.push(p))
    expect(result).toBe('failed')
    const failed = events.find((e) => e.state === 'failed')
    expect(failed?.kind).toBe('session_expired')
    expect(failed?.stage).toBe('fetching_course')
    expect(repo.get('p2')?.state).toBe('failed')
  })

  it('runTask without a listener still succeeds (listener optional)', async () => {
    const repo = new TaskRepository(db)
    repo.create('p3', 'l1')
    const { executors } = executorsThatFailAt('__never__')
    const result = await runTask(repo, 'p3', executors, 'fetching_course')
    expect(result).toBe('succeeded')
  })

  it('markFailed redacts credential-bearing error text before it reaches the db (review A4)', () => {
    const repo = new TaskRepository(db)
    repo.create('p4', 'l1')
    repo.markFailed(
      'p4',
      'downloading_video',
      '下载视频失败: ffmpeg Input https://dncvsvod/t.mp4?auth_key=SECRET9 failed',
      'network'
    )
    const row = repo.get('p4')
    expect(row?.error_message).not.toContain('SECRET9')
  })

  it('markSucceeded clears the fetching_course URL handoff; markFailed keeps it for resume (review A3)', () => {
    const repo = new TaskRepository(db)
    const handoff = JSON.stringify({ lessonId: 'l1', teacherStreamUrl: 'https://vod/t.mp4?auth_key=live' })
    // Task row first: task_stage_outputs.task_id is an FK to tasks.id.
    repo.create('s1', 'l1')
    db.prepare("INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES ('s1', 'fetching_course', ?)").run(handoff)
    repo.markSucceeded('s1')
    const cleared = db
      .prepare("SELECT COUNT(*) AS n FROM task_stage_outputs WHERE task_id = 's1' AND stage = 'fetching_course'")
      .get() as { n: number }
    expect(cleared.n).toBe(0)

    // A failed task is meant to be retried — the URL handoff survives so a
    // fresh-enough signed URL resumes without a re-harvest.
    repo.create('f1', 'l1')
    db.prepare("INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES ('f1', 'fetching_course', ?)").run(handoff)
    repo.markFailed('f1', 'downloading_video', '网络中断')
    const kept = db
      .prepare("SELECT COUNT(*) AS n FROM task_stage_outputs WHERE task_id = 'f1' AND stage = 'fetching_course'")
      .get() as { n: number }
    expect(kept.n).toBe(1)
  })
})
