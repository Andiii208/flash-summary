import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, utimesSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { TaskRepository, runTask, type StageExecutor } from '../src/main/tasks/queue'
import { SerialTaskQueue } from '../src/main/tasks/serial-queue'
import { cleanStaleCache } from '../src/main/tasks/cache-clean'
import { PIPELINE_STAGES, type Stage } from '../src/main/tasks/stages'

/** Backdated cache entry (directory mtime stamped for Windows semantics). */
function seedOld(cacheDir: string, name: string, oldTimeMs: number): void {
  const full = join(cacheDir, name)
  mkdirSync(full, { recursive: true })
  writeFileSync(join(full, 'a.bin'), 'x')
  utimesSync(join(full, 'a.bin'), oldTimeMs / 1000, oldTimeMs / 1000)
  utimesSync(full, oldTimeMs / 1000, oldTimeMs / 1000)
}

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-u4c-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-01T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-01T00:00:00Z')").run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function allOkExecutors(): Record<Stage, StageExecutor> {
  const map = {} as Record<Stage, StageExecutor>
  for (const stage of PIPELINE_STAGES) map[stage] = () => ({ status: 'ok' })
  return map
}

function repoOf(): TaskRepository {
  return new TaskRepository(db)
}

describe('SerialTaskQueue (U4)', () => {
  it('runs enqueued tasks one at a time in FIFO order', async () => {
    const queue = new SerialTaskQueue()
    const order: number[] = []
    const gate = (delay: number, id: number): (() => Promise<void>) => async () => {
      order.push(id)
      await new Promise((r) => setTimeout(r, delay))
    }
    const first = queue.enqueue('a', gate(40, 1))
    const second = queue.enqueue('b', gate(5, 2))
    const third = queue.enqueue('c', gate(0, 3))
    await Promise.all([first, second, third])
    expect(order).toEqual([1, 2, 3])
  })

  it('reports the currently running task id', async () => {
    const queue = new SerialTaskQueue()
    let seenDuring: string | null = null
    const run = queue.enqueue('t-running', async () => {
      await new Promise((r) => setTimeout(r, 20))
      seenDuring = queue.current()
    })
    expect(queue.current()).toBeNull()
    await run
    expect(seenDuring).toBe('t-running')
    expect(queue.current()).toBeNull()
  })

  it('rejects a duplicate id while the task is queued or running (review D1)', async () => {
    const queue = new SerialTaskQueue()
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      release = r
    })
    const first = queue.enqueue('dup', () => gate.then(() => 'ok'))
    await expect(queue.enqueue('dup', async () => 'again')).rejects.toThrowError(/已在队列中/)
    release!()
    await expect(first).resolves.toBe('ok')
    // After completion the id is free again.
    const second = queue.enqueue('dup', async () => 'second')
    await expect(second).resolves.toBe('second')
  })

  it('members() covers running AND queued ids (review D5)', async () => {
    const queue = new SerialTaskQueue()
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      release = r
    })
    const seen: string[][] = []
    const first = queue.enqueue('running-1', async () => {
      seen.push([...queue.members()])
      await gate
      return 'r1'
    })
    const second = queue.enqueue('queued-2', async () => 'r2')
    // While the first runs and the second waits, both are members.
    await new Promise((r) => setTimeout(r, 10))
    expect(queue.members()).toEqual(['running-1', 'queued-2'])
    release!()
    await Promise.all([first, second])
    expect(queue.members()).toEqual([])
    expect(seen[0]).toEqual(['running-1', 'queued-2'])
  })
})

describe('task cancellation (U4)', () => {
  it('marks a task failed(cancelled) when the signal aborts mid-pipeline', async () => {
    const repo = repoOf()
    repo.create('t1', 'l1')
    const controller = new AbortController()
    const events: string[] = []
    controller.abort()
    const result = await runTask(repo, 't1', allOkExecutors(), 'fetching_course', (p) => events.push(p.kind ?? p.state), controller.signal)
    expect(result).toBe('failed')
    const row = repo.get('t1')
    expect(row?.state).toBe('failed')
    expect(row?.error_kind).toBe('cancelled')
    expect(row?.error_message).toBe('任务已取消')
    expect(events).toContain('cancelled')
  })

  it('声明批7: 取消时一并清除签名直链交接（不留一条还有生命的 auth_key）', async () => {
    const repo = repoOf()
    repo.create('t1', 'l1')
    // The fetching_course handoff is the only place a plaintext signed URL
    // (auth_key) lands in app.db — cancelled tasks never resume from it.
    db.prepare("INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t1', 'fetching_course', ?)").run(
      JSON.stringify({ lessonId: 'l1', teacherStreamUrl: 'https://vod/t.mp4?auth_key=live' })
    )

    const controller = new AbortController()
    controller.abort()
    await runTask(repo, 't1', allOkExecutors(), 'fetching_course', undefined, controller.signal)

    const row = db
      .prepare("SELECT COUNT(*) AS n FROM task_stage_outputs WHERE task_id = 't1' AND stage = 'fetching_course'")
      .get() as { n: number }
    expect(row.n).toBe(0)
  })

  it('records the failure kind on a normal stage failure', async () => {
    const repo = repoOf()
    repo.create('t1', 'l1')
    const executors = {} as Record<Stage, StageExecutor>
    for (const stage of PIPELINE_STAGES) {
      executors[stage] = () =>
        stage === 'downloading_video' ? ({ status: 'failed', error: 'boom', kind: 'session_expired' } as const) : ({ status: 'ok' } as const)
    }
    const result = await runTask(repo, 't1', executors, 'fetching_course')
    expect(result).toBe('failed')
    const row = repo.get('t1')
    expect(row?.error_kind).toBe('session_expired')
    expect(row?.failed_stage).toBe('downloading_video')
  })
})

describe('cache cleanup skips running tasks (U4)', () => {
  it('keeps entries whose id is running, deletes the rest', () => {
    const cache = join(dir, 'cache')
    const oldTime = Date.now() - 25 * 60 * 60 * 1000
    seedOld(cache, 'task-running', oldTime)
    seedOld(cache, 'task-old', oldTime)
    const removed = cleanStaleCache(cache, Date.now(), 24 * 60 * 60 * 1000, new Set(['task-running']))
    expect(removed).toEqual(['task-old'])
    expect(existsSync(join(cache, 'task-running'))).toBe(true)
    expect(existsSync(join(cache, 'task-old'))).toBe(false)
  })
})

describe('db migration 005 error_kind', () => {
  it('exposes error_kind on task rows after marking', () => {
    const repo = repoOf()
    repo.create('t1', 'l1')
    repo.markFailed('t1', 'transcribing', 'killed', 'cancelled')
    const row = repo.get('t1')
    expect(row?.error_kind).toBe('cancelled')
  })
})
