// 批8 (audit 2026-09-28, H25): FakeIpc 与 electron 桩都提到共享 helper。
import { FakeIpc } from './helpers/fake-ipc'
import { stubElectron } from './helpers/electron-mock'

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'

vi.mock('electron', () => stubElectron())

setAppRendererOrigin('file:///app/index.html')

/**
 * 批7 (audit 2026-09-28, H14): `providers:test` 的 IPC 边界。
 *
 * 用户现象层：Provider 面板的「连接测试」按钮此前**双通道零验证**（单测 smoke 都没
 * 探到），而它是唯一一条让用户在保存凭据前先试通的路径——空 baseUrl 直接打网络、
 * probe 抛异常时界面怎么显示，全靠这一层。专为测试留的缝 `providerTestOverride`
 * 从来没用过，这里用起来：探针换成可断言的假函数，绝不碰真实 HTTP。
 */
const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

let db: Db
let dir: string
let ipc: FakeIpc

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-providers-probe-'))
  ipc = new FakeIpc()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeCtx(): AppContext {
  const ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  db = ctx.db
  return ctx
}

/** 用测试探针登记 IPC，返回探针本身（调用参数在此取证）。 */
function invokeWithProbe(
  ctx: AppContext,
  probe: (baseUrl: string, apiKey: string, model: string) => Promise<{ latencyMs: number; answer: string }>
): { probeSpy: ReturnType<typeof vi.fn>; call: (input: unknown) => Promise<unknown> } {
  const probeSpy = vi.fn(probe)
  registerIpc(ctx, ipc as never, { providerTestOverride: probeSpy })
  return { probeSpy, call: (input: unknown) => ipc.invoke('providers:test', input) }
}

describe('providers:test (M3 批 D) — 批7 H14 补口', () => {
  it('正常路径把表单三原样递给探针，并回传延迟与回答', async () => {
    const ctx = makeCtx()
    const { probeSpy, call } = invokeWithProbe(ctx, async () => ({ latencyMs: 42, answer: 'ok' }))
    const res = (await call({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' })) as {
      ok: boolean
      value?: { latencyMs: number; answer: string }
    }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ latencyMs: 42, answer: 'ok' })
    expect(probeSpy).toHaveBeenCalledWith('https://api.example.com/v1', 'sk-test', 'gpt-4o-mini')
  })

  it('apiKey 缺省按空串递下去（本地/免鉴权端点的合法形态）', async () => {
    const ctx = makeCtx()
    const { probeSpy, call } = invokeWithProbe(ctx, async () => ({ latencyMs: 1, answer: 'ok' }))
    const res = (await call({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen' })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(probeSpy).toHaveBeenCalledWith('http://127.0.0.1:11434/v1', '', 'qwen')
  })

  it('baseUrl 空串 → err 信封（不去打网络）', async () => {
    const ctx = makeCtx()
    const { probeSpy, call } = invokeWithProbe(ctx, async () => ({ latencyMs: 1, answer: 'ok' }))
    const res = (await call({ baseUrl: '', apiKey: 'k', model: 'm' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('baseUrl')
    expect(probeSpy).not.toHaveBeenCalled()
  })

  it('model 空串 → err 信封（同样不去打网络）', async () => {
    const ctx = makeCtx()
    const { probeSpy, call } = invokeWithProbe(ctx, async () => ({ latencyMs: 1, answer: 'ok' }))
    const res = (await call({ baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: '' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('model')
    expect(probeSpy).not.toHaveBeenCalled()
  })

  it('探针抛错 → err 信封（界面读得到失败原因，不是静默 loading）', async () => {
    const ctx = makeCtx()
    const { call } = invokeWithProbe(ctx, async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
    })
    const res = (await call({ baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'k', model: 'qwen' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('ECONNREFUSED')
  })
})
