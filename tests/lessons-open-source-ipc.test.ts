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
import type { Cryptor } from '../src/main/auth/session-crypto'


/**
 * 批 D (plan 2026-09-19-note-experience-overhaul): `lessons:openSource` 的 IPC 边界。
 *
 * 红线（AGENTS：打开外部网址只能经 main 侧固定常量）：渲染层只传 lessonId 与秒数，
 * URL 由 main 用常量基准 + 库内 bvid 拼。测试盯三件事：
 *   · SEU 源诚实拒绝（平台播放页没有时间参数——按源收窄的边界）；
 *   · 渲染层传任何怪值（字符串/URL）都进不了 openExternal；
 *   · 桥面只有 openSource 一个方法。
 */

// 批8 (audit 2026-09-28, H25): electron 桩提到共享 helper——14 份拷贝收成一份。
// openExternal 调用参数是本测试的红线断言对象，在共享桩上就地覆写。
const openExternal = vi.hoisted(() => vi.fn(async (_url: string) => undefined))

vi.mock('electron', () => {
  const electron = stubElectron()
  electron.shell.openExternal = openExternal
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-opensrc-'))
  ipc = new FakeIpc()
  openExternal.mockClear()
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

function invoke(ctx: AppContext, channel: string, ...args: unknown[]): Promise<unknown> {
  registerIpc(ctx, ipc as never)
  return ipc.invoke(channel, ...args)
}

/** 造假数据：SEU 课 / B 站课（带 bvid）/ B 站多 P 课。 */
function seedLessons(ctx: AppContext): void {
  ctx.db
    .prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('c-seu', '电子电路', 'seu', NULL, '2026-09-20T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO lessons (id, course_id, title, source, fetched_at) VALUES ('l-seu', 'c-seu', '第5讲', 'seu', '2026-09-20T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('c-bili', '数据结构', 'bilibili', 'BV1tNpbekEht', '2026-09-20T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO lessons (id, course_id, title, source, bili_page, fetched_at) VALUES ('l-bili', 'c-bili', '第1讲', 'bilibili', 1, '2026-09-20T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO lessons (id, course_id, title, source, bili_page, fetched_at) VALUES ('l-bili-p3', 'c-bili', '第3讲', 'bilibili', 3, '2026-09-20T00:00:00Z')")
    .run()
  // 库内 BV 号被改坏的课（纵深防御用例）。
  ctx.db
    .prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('c-bad', '坏数据', 'bilibili', 'javascript:alert(1)', '2026-09-20T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO lessons (id, course_id, title, source, fetched_at) VALUES ('l-bad', 'c-bad', '坏课', 'bilibili', '2026-09-20T00:00:00Z')")
    .run()
}

describe('lessons:openSource（批 D：B 站 ?t= 跳转，红线不收窄）', () => {
  it('B 站课时：main 拼常量基准 URL 并经 shell.openExternal 打开', async () => {
    const ctx = makeCtx()
    seedLessons(ctx)
    const res = (await invoke(ctx, 'lessons:openSource', 'l-bili', 185)) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1tNpbekEht?t=185')
  })

  it('多 P 课时带 p= 参数', async () => {
    const ctx = makeCtx()
    seedLessons(ctx)
    await invoke(ctx, 'lessons:openSource', 'l-bili-p3', 60)
    expect(openExternal).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1tNpbekEht?t=60&p=3')
  })

  it('SEU 源课时：如实拒绝且绝不打开任何外部页', async () => {
    const ctx = makeCtx()
    seedLessons(ctx)
    const res = (await invoke(ctx, 'lessons:openSource', 'l-seu', 60)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('SEU')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('渲染层传怪值：字符串/URL/对象都进不了 openExternal（注入面）', async () => {
    const ctx = makeCtx()
    seedLessons(ctx)
    await invoke(ctx, 'lessons:openSource', 'l-bili', 'https://evil.example.com/steal')
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1tNpbekEht?t=0')
    expect(String(openExternal.mock.calls[0]?.[0] ?? '')).not.toContain('evil')
  })

  it('库内 BV 号不合法：拒绝跳转（纵深防御）', async () => {
    const ctx = makeCtx()
    seedLessons(ctx)
    const res = (await invoke(ctx, 'lessons:openSource', 'l-bad', 60)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('课时不存在：如实说明', async () => {
    const ctx = makeCtx()
    seedLessons(ctx)
    const res = (await invoke(ctx, 'lessons:openSource', 'l-missing', 60)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('课时不存在')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('非法 lessonId 被 assertSafeId 拦在库里查询之前', async () => {
    const ctx = makeCtx()
    seedLessons(ctx)
    const res = (await invoke(ctx, 'lessons:openSource', '../escape', 60)) as { ok: boolean }
    expect(res.ok).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('桥面 lessons 节只有 openSource 一个方法', async () => {
    const fs = await import('fs')
    const preloadSource = fs.readFileSync('src/preload/index.ts', 'utf8')
    const start = preloadSource.indexOf('  lessons: {')
    const closeTag = String.fromCharCode(10) + '  },'
    const lessonsBlock = preloadSource.slice(start, preloadSource.indexOf(closeTag, start))
    const methods = [...lessonsBlock.matchAll(/^\s{4}(\w+):/gm)].map((matched) => matched[1])
    expect(methods).toEqual(['openSource'])
  })
})
