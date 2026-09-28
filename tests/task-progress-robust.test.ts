// 批8 (audit 2026-09-28, H25): FakeIpc / electron 桩提到共享 helper（12 份拷贝收成一份）。
import { FakeIpc } from './helpers/fake-ipc'
import { stubElectron } from './helpers/electron-mock'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import { TaskRepository, runTask, type StageExecutor } from '../src/main/tasks/queue'
import { PIPELINE_STAGES, type Stage } from '../src/main/tasks/stages'
import type { Cryptor } from '../src/main/auth/session-crypto'


// 批8 (audit 2026-09-28, H25): electron 桩提到共享 helper——14 份拷贝收成一份。
const electronApp = vi.hoisted(() => ({ isPackaged: false, getVersion: () => '0.0.0-test' }))

vi.mock('electron', () => {
  const electron = stubElectron()
  electron.app = electronApp
  return electron
})

setAppRendererOrigin('file:///app/index.html')


const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

let db: Db
let dir: string
let ipc: FakeIpc
let ctx: AppContext

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-progress-robust-'))
  ipc = new FakeIpc()
  ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  db = ctx.db
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-19T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-19T00:00:00Z')").run()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('runTask: a throwing onProgress must not wedge the row (批5 双保险之一)', () => {
  it('stage failure with a dead progress listener still resolves and lands the row failed', async () => {
    const repo = new TaskRepository(db)
    repo.create('t1', 'l1')
    const executors = {} as Record<Stage, StageExecutor>
    for (const stage of PIPELINE_STAGES) {
      executors[stage] = () => (stage === 'downloading_video' ? ({ status: 'failed', error: 'boom' } as const) : ({ status: 'ok' } as const))
    }
    // The renderer bridge is gone: every progress push throws.
    const onProgress = (): void => {
      throw new Error('renderer bridge dead')
    }

    const result = await runTask(repo, 't1', executors, 'fetching_course', onProgress)

    expect(result).toBe('failed')
    const row = repo.get('t1')
    expect(row?.state).toBe('failed')
    expect(row?.failed_stage).toBe('downloading_video')
  })
})

describe('launchTask: a throw before runTask marks the row failed (批5 双保险之二)', () => {
  it('executor wiring failure leaves no non-terminal task row', async () => {
    registerIpc(ctx, ipc as never, {
      newTaskId: () => 't-wiring',
      executorsOverride: () => {
        throw new Error('executor wiring exploded')
      }
    })
    const created = (await ipc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    const taskId = created.value!.id
    await ipc.invoke('tasks:runAsync', taskId)
    // The enqueue callback throws before any stage runs.
    await new Promise((r) => setTimeout(r, 60))

    const row = new TaskRepository(db).get(taskId)
    expect(row?.state).toBe('failed')
    expect(row?.error_message).toContain('executor wiring exploded')
  })
})
