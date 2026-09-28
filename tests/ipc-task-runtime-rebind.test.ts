import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { waitFor } from './helpers/wait-for'
import { FakeIpc } from './helpers/fake-ipc'
import { stubElectron } from './helpers/electron-mock'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import { TaskRepository, type StageExecutor } from '../src/main/tasks/queue'
import { PIPELINE_STAGES, type Stage } from '../src/main/tasks/stages'
import type { Cryptor } from '../src/main/auth/session-crypto'

/**
 * H7 (audit 2026-09-28) + 批3c: registerIpc 二次注册后的状态存活与两处收尾。
 *
 * index.ts 的 app 'activate' 会在窗口重建后再次 registerIpc（removeHandler 兜住
 * 重复注册）。修复前队列/abortControllers/pendingPdfExports/idleListeners 全是
 * registerIpc 的闭包状态，二次注册即整套换新——这里逐条钉住提升到 ctx 后的行为。
 */

// 批8 (audit 2026-09-28, H25) 共享 electron 桩：工厂在 hoisted 里调用，import 已就绪。
vi.mock('electron', () => stubElectron())

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
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-runtime-rebind-'))
  ipc = new FakeIpc()
  ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  db = ctx.db
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-28T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第1讲', '2026-09-28T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '第2讲', '2026-09-28T00:00:00Z')").run()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.SEU_PDF_PATH
})

/**
 * 闸门化 executor：任务在每个 stage 入口记录一行并挂起，直到「放行」或「取消」
 * （signal.abort）——测试因此能把任务稳稳按在在跑/排队状态上。
 */
function gatedExecutors(gates: Map<string, Promise<void>>, entered: string[]) {
  return (): Record<Stage, StageExecutor> => {
    const executors = {} as Record<Stage, StageExecutor>
    for (const stage of PIPELINE_STAGES) {
      executors[stage] = async (taskCtx) => {
        entered.push(`${taskCtx.taskId}:${stage}`)
        await new Promise<void>((resolve) => {
          const gate = gates.get(taskCtx.taskId)
          if (gate != null) void gate.then(resolve)
          taskCtx.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { status: 'ok' as const }
      }
    }
    return executors
  }
}

describe('H7: registerIpc 二次注册后任务运行时状态继续有效', () => {
  it('二次注册后 isTaskRunning 仍 true、setCacheDir 守卫生效、旧任务仍可取消', async () => {
    const gates = new Map<string, Promise<void>>()
    let release: () => void = () => undefined
    gates.set('t-run', new Promise<void>((resolve) => {
      release = resolve
    }))
    const entered: string[] = []
    const options = { newTaskId: () => 't-run', executorsOverride: gatedExecutors(gates, entered) }

    const first = registerIpc(ctx, ipc as never, options)
    const created = (await ipc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    expect(created.value?.id).toBe('t-run')
    await ipc.invoke('tasks:runAsync', 't-run')
    await waitFor(() => expect(entered).toContain('t-run:fetching_course'), 5000)
    expect(first.isTaskRunning()).toBe(true)

    // app 'activate'：同一个 ctx、同一个 ipcMain 再注册一次。
    const second = registerIpc(ctx, ipc as never, options)
    // 旧任务跑在 ctx 的队列上——新 handle 必须看得见它。
    expect(second.isTaskRunning()).toBe(true)
    // 在跑守卫：半途换缓存根会把同一任务的产物劈到新旧两个目录。
    const blocked = (await ipc.invoke('settings:setCacheDir', join(dir, 'new-cache'))) as { ok: boolean; error?: string }
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toContain('有任务在运行')
    // 取消也必须打到旧任务身上（新 handle 的映射不是空的）。
    second.cancelRunning()
    // 放行闸门让被取消的任务走完收尾（abort 已让它无条件返回），队列随后排空——
    // index.ts 的托盘「队列排空恢复窗口」挂在同一条线上。
    release()
    await waitFor(() => {
      const row = new TaskRepository(db).get('t-run')
      expect(row?.state).toBe('failed')
      expect(row?.error_kind).toBe('cancelled')
    }, 5000)
    expect(second.isTaskRunning()).toBe(false)
  })

  it('二次注册后 PDF 一次性令牌仍有效（渲染层始终只能写 main 自己登记的路径）', async () => {
    process.env.SEU_PDF_PATH = join(dir, 'handout.pdf')
    const first = registerIpc(ctx, ipc as never)
    const dialog = (await ipc.invoke('notes:exportPdfDialog', 'l1')) as { ok: boolean; value?: { token: string } }
    expect(dialog.ok).toBe(true)
    expect(dialog.value?.token).toBeTruthy()

    const second = registerIpc(ctx, ipc as never)
    const write = (await ipc.invoke('notes:exportPdfWrite', dialog.value!.token)) as { ok: boolean; error?: string }
    expect(write.ok).toBe(false)
    // 令牌跨注册存活：卡在「没有主窗口」这一步，而不是「导出会话无效或已过期」。
    expect(write.error).toContain('主窗口不可用')
    expect(write.error).not.toContain('导出会话无效')
    // 消费是一次性的：第二次写同一个 token 必须失效。
    const again = (await ipc.invoke('notes:exportPdfWrite', dialog.value!.token)) as { ok: boolean; error?: string }
    expect(again.error).toContain('导出会话无效')
    expect(second).toBeDefined()
    expect(first).toBeDefined()
  })
})

describe('批3c: 排队中被取消的任务由 queue.ts 的 signal 复检兜底', () => {
  it('取消在排队任务：出队后靠 signal.aborted 复检落终态（cancelledWhileQueued 死代码的替身）', async () => {
    const gates = new Map<string, Promise<void>>()
    let releaseA: () => void = () => undefined
    gates.set('t-a', new Promise<void>((resolve) => {
      releaseA = resolve
    }))
    const entered: string[] = []
    const handle = registerIpc(ctx, ipc as never, {
      executorsOverride: gatedExecutors(gates, entered),
      newTaskId: (() => {
        let n = 0
        return () => (n++ === 0 ? 't-a' : 't-b')
      })()
    })
    expect(handle).toBeDefined()

    const createdA = (await ipc.invoke('tasks:create', 'l1')) as { ok: boolean; value?: { id: string } }
    const createdB = (await ipc.invoke('tasks:create', 'l2')) as { ok: boolean; value?: { id: string } }
    expect(createdA.value?.id).toBe('t-a')
    expect(createdB.value?.id).toBe('t-b')
    await ipc.invoke('tasks:runAsync', 't-a')
    await waitFor(() => expect(entered).toContain('t-a:fetching_course'), 5000)
    // t-a 占着串行队列，t-b 排在后面。
    await ipc.invoke('tasks:runAsync', 't-b')
    expect(entered.some((e) => e.startsWith('t-b:'))).toBe(false)

    const cancelled = (await ipc.invoke('tasks:cancel', 't-b')) as { ok: boolean }
    expect(cancelled.ok).toBe(true)

    // 放行 t-a → t-b 出队。取消的兜底不是前置集合（已删），而是 runTask 首轮
    // 的 signal.aborted 复检（tasks/queue.ts:134）。
    releaseA()
    await waitFor(() => {
      const row = new TaskRepository(db).get('t-b')
      expect(row?.state).toBe('failed')
      expect(row?.error_kind).toBe('cancelled')
    }, 5000)
    // 复检发生在第一个 stage 之前——排队中被取消的任务一个 stage 都不该跑。
    expect(entered.some((e) => e.startsWith('t-b:'))).toBe(false)
    const aRow = new TaskRepository(db).get('t-a')
    expect(aRow?.state).toBe('succeeded')
  })
})

describe('批3c: bilibili:logout 的清理失败回 err 信封', () => {
  it('session 文件删不掉（EBUSY/EPERM/EISDIR）时给 ApiResult，不是裸异常跨桥', async () => {
    registerIpc(ctx, ipc as never)
    // 用一个目录顶掉 session.bin 的位置：rmSync 对目录必然抛错，且完全确定。
    const sessionFile = join(dir, 'userdata', 'bilibili-session', 'session.bin')
    mkdirSync(sessionFile, { recursive: true })
    const res = (await ipc.invoke('bilibili:logout')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })
})
