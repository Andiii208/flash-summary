// 批8 (audit 2026-09-28, H25): FakeIpc / electron 桩提到共享 helper（12 份拷贝收成一份）。
import { FakeIpc } from './helpers/fake-ipc'
import { stubElectron } from './helpers/electron-mock'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'
import type { PlayHarvestResult } from '../src/main/school/play-harvest'


// 批8 (audit 2026-09-28, H25): electron 桩提到共享 helper——14 份拷贝收成一份。
vi.mock('electron', () => stubElectron())

setAppRendererOrigin('file:///app/index.html')


const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

let dir: string
let ipc: FakeIpc
let ctx: AppContext

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-harvest-race-'))
  ipc = new FakeIpc()
  ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  ctx.db
    .prepare("INSERT INTO courses (id, name, tecl_id, tecl_code, fetched_at) VALUES ('c1', '课程', '154717', 'TC1', '2026-09-19T00:00:00Z')")
    .run()
  registerIpc(ctx, ipc as never)
})

afterEach(() => {
  ctx.db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return ipc.invoke(channel, ...args)
}

describe('harvestRuntime.start 归属 (批5)', () => {
  it('only the call that newly claimed the course owns the slot', () => {
    expect(ctx.harvestRuntime.start('c1')).toBe(true)
    expect(ctx.harvestRuntime.start('c1')).toBe(false)
    ctx.harvestRuntime.finish('c1', { ok: true, lessons: 1 })
    expect(ctx.harvestRuntime.start('c1')).toBe(true)
  })
})

describe('school:harvestLessons 二次调用不清第一次的在途 (批5)', () => {
  it('single-flight rejection keeps the first harvest’s marker and outcome intact', async () => {
    let releaseFirst: ((value: PlayHarvestResult) => void) | null = null
    let calls = 0
    // Emulate app-context's single-flight guard: the first call navigates
    // the window and hangs; the second is refused.
    ctx.harvestCoursePage = (async () => {
      calls += 1
      if (calls === 1) {
        return await new Promise<PlayHarvestResult>((resolve) => {
          releaseFirst = resolve
        })
      }
      throw new Error('已有播放页抓取在进行中，请稍候')
    }) as AppContext['harvestCoursePage']

    const first = invoke('school:harvestLessons', 'c1')
    // Let the first handler park on its hanging harvest.
    await new Promise((r) => setTimeout(r, 10))

    const second = (await invoke('school:harvestLessons', 'c1')) as { ok: boolean; error?: string }
    expect(second.ok).toBe(false)
    expect(String(second.error)).toContain('在进行中')

    // The rejected second call must NOT clear the first's in-flight marker.
    const during = (await invoke('school:harvestState')) as {
      ok: boolean
      value?: { inflight: string[]; outcome: { seq: number; courseId: string; ok: boolean; lessons: number } | null }
    }
    expect(during.value?.inflight).toEqual(['c1'])
    expect(during.value?.outcome).toBeNull()

    releaseFirst!({
      teacherStreamUrl: 'https://dncvsvod/t.mp4?auth_key=x',
      screenStreamUrl: 'https://dncvsvod/s.mp4?auth_key=y',
      lessons: [
        { index: 0, title: '第1节课', ref: '0' },
        { index: 1, title: '第2节课', ref: '1' }
      ]
    })
    const firstRes = (await first) as { ok: boolean; value?: { lessons: number } }
    expect(firstRes.ok).toBe(true)
    expect(firstRes.value?.lessons).toBe(2)

    const after = (await invoke('school:harvestState')) as {
      ok: boolean
      value?: { inflight: string[]; outcome: { seq: number; courseId: string; ok: boolean; lessons: number } | null }
    }
    expect(after.value?.inflight).toEqual([])
    expect(after.value?.outcome).toMatchObject({ courseId: 'c1', ok: true, lessons: 2 })
  })
})
