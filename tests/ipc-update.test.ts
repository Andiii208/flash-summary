// 2026-09-30 (plan 2026-09-30-public-release-autoupdate): 更新 IPC 通道测试。
// 直接打导出的 registerUpdateHandlers（registerIpc 内部就是调它）——控制器
// 是注入的假实现，真实 electron-updater 装配由 smoke 的 update:check 探针兜底。
import { FakeIpc } from './helpers/fake-ipc'
import { stubElectron } from './helpers/electron-mock'
import { setAppRendererOrigin, registerUpdateHandlers } from '../src/main/ipc'
import { createUpdateController, type AutoUpdaterLike, type UpdateAppLike } from '../src/main/update'
import { describe, expect, it, beforeEach, vi } from 'vitest'

// E1 的拒否分支要读 app.isPackaged（非 file:// 调用方）——按共享 stub 补上。
// 注意 vi.hoisted 回调里不能碰 import 绑定（TDZ），stubElectron() 必须在
// vi.mock 工厂内调用（与 ipc-settings.test.ts 同一写法）。
const electronApp = vi.hoisted(() => ({ isPackaged: false, getVersion: () => '0.0.0-test' }))
vi.mock('electron', () => {
  const electron = stubElectron()
  electron.app = electronApp
  return electron
})

// E1: FakeIpc 以应用 renderer URL 调用——不注入 origin 会被 assertAppSender 拒。
setAppRendererOrigin('file:///app/index.html')

function fakeUpdater(): AutoUpdaterLike {
  const listeners = new Map<string, Array<(info: unknown) => void>>()
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '0.7.13' } })),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    on: (channel: string, listener: (info: unknown) => void) => {
      const list = listeners.get(channel) ?? []
      list.push(listener)
      listeners.set(channel, list)
    }
  }
}

const packaged: UpdateAppLike = { isPackaged: true }

let ipc: FakeIpc
let sent: Array<{ channel: string; payload: unknown }>

beforeEach(() => {
  ipc = new FakeIpc()
  sent = []
})

function register(controller?: ReturnType<typeof createUpdateController>): void {
  registerUpdateHandlers(ipc, controller, { send: (channel, payload) => sent.push({ channel, payload }) })
}

describe('update IPC handlers', () => {
  it('三个 invoke 通道登记（update:event 是 push-only，不经 handle）', () => {
    register(createUpdateController({ app: packaged, updater: fakeUpdater() }))
    expect([...ipc.handlers.keys()].sort()).toEqual(['update:check', 'update:download', 'update:install'])
  })

  it('update:check 有更新时回 available + 版本号信封', async () => {
    register(createUpdateController({ app: packaged, updater: fakeUpdater() }))
    const res = (await ipc.invoke('update:check')) as { ok: boolean; value: { status: string; version?: string } }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ status: 'available', version: '0.7.13' })
  })

  it('update:download / update:install 透传控制器结果', async () => {
    register(createUpdateController({ app: packaged, updater: fakeUpdater() }))
    const down = (await ipc.invoke('update:download')) as { ok: boolean; value: { started: boolean } }
    const install = (await ipc.invoke('update:install')) as { ok: boolean; value: { installed: boolean } }
    expect(down.value).toEqual({ started: true })
    expect(install.value).toEqual({ installed: true })
  })

  it('下载进度经 sender 推到渲染层（channel + payload 原样）', async () => {
    const updater = fakeUpdater()
    const listeners = new Map<string, Array<(info: unknown) => void>>()
    updater.on = (channel: string, listener: (info: unknown) => void): void => {
      const list = listeners.get(channel) ?? []
      list.push(listener)
      listeners.set(channel, list)
    }
    register(createUpdateController({ app: packaged, updater }))
    for (const listener of listeners.get('download-progress') ?? []) listener({ percent: 66 })
    expect(sent).toEqual([{ channel: 'update:event', payload: { type: 'progress', percent: 66 } }])
  })

  it('没有 controller 时如实回 unsupported，而不是「通道不存在」', async () => {
    register(undefined)
    const res = (await ipc.invoke('update:check')) as { ok: boolean; value: { status: string } }
    expect(res.ok).toBe(true)
    expect(res.value.status).toBe('unsupported')
  })

  it('渲染层传任何参数都改不了更新源：check 不接 URL，调用参数被忽略', async () => {
    const updater = fakeUpdater()
    register(createUpdateController({ app: packaged, updater }))
    // 恶意/误传的 feed 地址不得被消费——假的 updater 只可能收到零参调用。
    await ipc.invoke('update:check', { feedUrl: 'https://evil.example.com/steal', provider: 'generic' })
    expect(vi.mocked(updater.checkForUpdates)).toHaveBeenCalledWith()
  })

  it('非应用 renderer 调用被 E1 拒（与其它通道同一道闸）', async () => {
    register(createUpdateController({ app: packaged, updater: fakeUpdater() }))
    await expect(ipc.invokeFrom('https://evil.example.com', 'update:check')).rejects.toThrow('非法调用方')
  })
})
