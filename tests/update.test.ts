// 2026-09-30 (plan 2026-09-30-public-release-autoupdate): 更新控制器单测。
// 控制器是纯逻辑 + 依赖注入——这里不 import electron / electron-updater，
// app 与 autoUpdater 全给假的；真实装配（index.ts）由 smoke 的 update:check
// 探针端到端兜底。
import { describe, expect, it, vi } from 'vitest'
import { createUpdateController, UPDATE_FEED, type AutoUpdaterLike, type UpdateAppLike } from '../src/main/update'

interface FakeUpdater extends AutoUpdaterLike {
  calls: { checkForUpdates: number; downloadUpdate: number; quitAndInstall: number }
  listeners: Map<string, Array<(info: unknown) => void>>
  checkResult: { updateInfo: { version: string } } | null
  checkError: Error | null
  downloadError: Error | null
  emit(channel: string, info: unknown): void
}

function makeUpdater(overrides?: Partial<FakeUpdater>): FakeUpdater {
  const listeners = new Map<string, Array<(info: unknown) => void>>()
  const fake: FakeUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    calls: { checkForUpdates: 0, downloadUpdate: 0, quitAndInstall: 0 },
    listeners,
    checkResult: null,
    checkError: null,
    downloadError: null,
    checkForUpdates: vi.fn(async () => {
      fake.calls.checkForUpdates += 1
      if (fake.checkError != null) throw fake.checkError
      return fake.checkResult
    }),
    downloadUpdate: vi.fn(async () => {
      fake.calls.downloadUpdate += 1
      if (fake.downloadError != null) throw fake.downloadError
      return ['C:\\cache\\Setup.exe']
    }),
    quitAndInstall: vi.fn(() => {
      fake.calls.quitAndInstall += 1
    }),
    on: vi.fn((channel: string, listener: (info: unknown) => void) => {
      const list = listeners.get(channel) ?? []
      list.push(listener)
      listeners.set(channel, list)
    }),
    emit(channel: string, info: unknown): void {
      for (const listener of listeners.get(channel) ?? []) listener(info)
    },
    ...overrides
  }
  return fake
}

const packaged = (): UpdateAppLike => ({ isPackaged: true })
const dev = (): UpdateAppLike => ({ isPackaged: false })

describe('update controller', () => {
  it('构造时即关掉自动下载、打开退出兜底安装', () => {
    const updater = makeUpdater()
    createUpdateController({ app: packaged(), updater })
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('未打包（开发模式）不联网：unsupported 且 checkForUpdates 零调用', async () => {
    const updater = makeUpdater()
    const controller = createUpdateController({ app: dev(), updater })
    const info = await controller.check()
    expect(info.status).toBe('unsupported')
    expect(updater.calls.checkForUpdates).toBe(0)
  })

  it('有新版本 → available + 版本号', async () => {
    const updater = makeUpdater({ checkResult: { updateInfo: { version: '0.7.13' } } })
    const controller = createUpdateController({ app: packaged(), updater })
    await expect(controller.check()).resolves.toEqual({ status: 'available', version: '0.7.13' })
  })

  it('checkForUpdates 返回 null（无更新）→ up-to-date', async () => {
    const updater = makeUpdater({ checkResult: null })
    const controller = createUpdateController({ app: packaged(), updater })
    await expect(controller.check()).resolves.toEqual({ status: 'up-to-date' })
  })

  // 2026-10-01 契约变更（plan 2026-10-01-note-inline-images-and-updater-feed）：v0.7.13
  // 上线时 feed 缺 latest.yml，上游原始 message（含 URL 与打包堆栈）被原样印在设置页。
  // 原断言写的是「info.message === 原文（透传）」——新契约是脱敏短句 + 原始进 onCheckFailure。
  it('检查抛错（无外网/上游故障）→ error + 脱敏短句，原始 message 进 onCheckFailure', async () => {
    const updater = makeUpdater({ checkError: new Error('net::ERR_INTERNET_DISCONNECTED') })
    const raws: string[] = []
    const controller = createUpdateController({ app: packaged(), updater, onCheckFailure: (raw) => raws.push(raw) })
    const info = await controller.check()
    expect(info.status).toBe('error')
    expect(info.message).toBe('暂时无法检查更新：网络或发布服务器无响应，请稍后重试。')
    expect(info.message).not.toContain('ERR_INTERNET_DISCONNECTED')
    expect(raws).toEqual(['net::ERR_INTERNET_DISCONNECTED'])
  })

  it('feed 渠道文件缺失（latest.yml 404）→ 渠道缺失文案，不带上游 URL 与堆栈', async () => {
    const httpError = Object.assign(
      new Error(
        'Cannot find latest.yml in the latest release artifacts (https://github.com/Andiii208/flash-summary/releases/download/v0.7.13/latest.yml): HttpError: 404 at createHttpError'
      ),
      { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }
    )
    const updater = makeUpdater({ checkError: httpError })
    const raws: string[] = []
    const controller = createUpdateController({ app: packaged(), updater, onCheckFailure: (raw) => raws.push(raw) })
    const info = await controller.check()
    expect(info.status).toBe('error')
    expect(info.message).toBe('暂时无法检查更新：发布渠道信息缺失，请稍后重试或前往本项目 GitHub 发布页查看。')
    expect(info.message).not.toContain('github.com')
    expect(info.message).not.toContain('createHttpError')
    expect(raws).toHaveLength(1)
    expect(raws[0]).toContain('latest.yml')
  })

  it('checkForUpdates 抛非 Error 值 → 仍走脱敏文案且不吞原始详情', async () => {
    const updater = makeUpdater()
    updater.checkForUpdates = vi.fn(async () => {
      throw 'raw string failure'
    })
    const raws: string[] = []
    const controller = createUpdateController({ app: packaged(), updater, onCheckFailure: (raw) => raws.push(raw) })
    const info = await controller.check()
    expect(info.status).toBe('error')
    expect(info.message).toBe('暂时无法检查更新：网络或发布服务器无响应，请稍后重试。')
    expect(raws).toEqual(['raw string failure'])
  })

  it('download 转发；在跑期间再来一次返回 started:false（连点守卫）', async () => {
    const gate: { release?: () => void } = {}
    const updater = makeUpdater()
    updater.downloadUpdate = vi.fn(
      () =>
        new Promise<Array<string>>((resolve) => {
          gate.release = () => resolve(['C:\\cache\\Setup.exe'])
        })
    )
    const controller = createUpdateController({ app: packaged(), updater })
    const first = controller.download()
    await expect(controller.download()).resolves.toEqual({ started: false })
    gate.release?.()
    await expect(first).resolves.toEqual({ started: true })
  })

  it('下载失败：started:false 且emit error 事件（不裸抛）', async () => {
    const updater = makeUpdater({ downloadError: new Error('下载中断') })
    const controller = createUpdateController({ app: packaged(), updater })
    const events: unknown[] = []
    controller.subscribe((e) => events.push(e))
    await expect(controller.download()).resolves.toEqual({ started: false })
    expect(events).toEqual([{ type: 'error', message: '下载中断' }])
  })

  it('下载进度 / 完成事件转成渲染层 UpdateEvent', () => {
    const updater = makeUpdater()
    const controller = createUpdateController({ app: packaged(), updater })
    const events: Array<{ type: string }> = []
    controller.subscribe((e) => events.push(e as { type: string }))
    updater.emit('download-progress', { percent: 42.6 })
    updater.emit('update-downloaded', { version: '0.7.13' })
    updater.emit('error', new Error('炸了'))
    expect(events).toEqual([
      { type: 'progress', percent: 43 },
      { type: 'downloaded', version: '0.7.13' },
      { type: 'error', message: '炸了' }
    ])
  })

  it('install 走 quitAndInstall（无参——静默/强起参数不使用）', async () => {
    const updater = makeUpdater()
    const controller = createUpdateController({ app: packaged(), updater })
    await expect(controller.install()).resolves.toEqual({ installed: true })
    expect(updater.calls.quitAndInstall).toBe(1)
  })

  it('退订后不再收到事件', () => {
    const updater = makeUpdater()
    const controller = createUpdateController({ app: packaged(), updater })
    const events: unknown[] = []
    const off = controller.subscribe((e) => events.push(e))
    off()
    updater.emit('download-progress', { percent: 10 })
    expect(events).toEqual([])
  })

  it('UPDATE_FEED 钉死 github / Andiii208 / flash-summary', () => {
    expect(UPDATE_FEED).toEqual({ provider: 'github', owner: 'Andiii208', repo: 'flash-summary' })
  })
})
