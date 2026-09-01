import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, utimesSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { TaskRepository, runTask, type StageExecutor, type StageOutputStore } from '../src/main/tasks/queue'
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

function makeOutputs(): StageOutputStore {
  return { record: () => undefined, has: () => false }
}

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
})

describe('task cancellation (U4)', () => {
  it('marks a task failed(cancelled) when the signal aborts mid-pipeline', async () => {
    const repo = repoOf()
    repo.create('t1', 'l1')
    const controller = new AbortController()
    const events: string[] = []
    controller.abort()
    const result = await runTask(repo, 't1', allOkExecutors(), makeOutputs(), 'fetching_course', (p) => events.push(p.kind ?? p.state), controller.signal)
    expect(result).toBe('failed')
    const row = repo.get('t1')
    expect(row?.state).toBe('failed')
    expect(row?.error_kind).toBe('cancelled')
    expect(row?.error_message).toBe('任务已取消')
    expect(events).toContain('cancelled')
  })

  it('records the failure kind on a normal stage failure', async () => {
    const repo = repoOf()
    repo.create('t1', 'l1')
    const executors = {} as Record<Stage, StageExecutor>
    for (const stage of PIPELINE_STAGES) {
      executors[stage] = () =>
        stage === 'downloading_video' ? ({ status: 'failed', error: 'boom', kind: 'session_expired' } as const) : ({ status: 'ok' } as const)
    }
    const result = await runTask(repo, 't1', executors, makeOutputs(), 'fetching_course')
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
