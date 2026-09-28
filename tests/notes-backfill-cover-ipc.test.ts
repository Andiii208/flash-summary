// 批8 (audit 2026-09-28, H25): FakeIpc / electron 桩提到共享 helper（12 份拷贝收成一份）。
import { FakeIpc } from './helpers/fake-ipc'
import { stubElectron } from './helpers/electron-mock'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'
import type { FetchLike } from '../src/main/bilibili/client'


/**
 * 批3 (plan 2026-09-20, P1/D8): `notes:backfillCover` 的 IPC 边界 + 导入日志的封面成败。
 *
 * 用户现象：B 站导入的课时有时没有封面，更早导入的「永远」没有封面，失败时界面和
 * 日志都不提一个字。这里盯四件事：
 *   · 只有 B 站源的课时能补取（SEU 源如实拒绝，且**一个请求都不发**）；
 *   · 库内 BV 号被改坏时拒绝请求（纵深防御：请求用的 BV 从库里取，仍要过形态校验）；
 *   · 成功路径真的落盘 + 写回 cover_path（`notes:cover` 能读回同一张图）；
 *   · 失败路径返回人话错误且**不动库里既有的 cover_path**。
 * 另钉导入日志：`bilibili import: … cover=ok|fetched-failed|skipped`。
 */

// 批8 (audit 2026-09-28, H25): electron 桩提到共享 helper——14 份拷贝收成一份。
vi.mock('electron', () => stubElectron())

setAppRendererOrigin('file:///app/index.html')


const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

/** 1x1 PNG 的字节（过 saveLessonCover 的解码与大小校验）。 */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const COVER_URL = 'https://i0.hdslb.com/cover.jpg'

const VIEW_PAYLOAD = {
  code: 0,
  data: {
    bvid: 'BV1tNpbekEht',
    title: '数据结构全集',
    pic: COVER_URL,
    cid: 1001,
    duration: 300,
    rights: { is_ugc_pay: 0 },
    owner: { mid: 42 },
    pages: [{ page: 1, cid: 1001, part: 'P1 绪论', duration: 300 }]
  }
}

let db: Db
let dir: string
let ipc: FakeIpc

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-backfill-'))
  ipc = new FakeIpc()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function jsonResponse(body: unknown): ReturnType<FetchLike> {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    url: 'https://api.bilibili.com/fake',
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0)
  })
}

/** 封面图响应：contentType 非 image/* 时 fetchImageAsDataUrl 如实返回 null。 */
function imageResponse(contentType: string): ReturnType<FetchLike> {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
    url: COVER_URL,
    json: async () => ({}),
    text: async () => '',
    arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength)
  })
}

/** 造一个 B 站客户端替身：view 返回 pic，图片路由按 contentType 作答。 */
function makeFetch(options: { pic?: string; imageContentType?: string; calls?: string[] } = {}): FetchLike {
  return async (url) => {
    options.calls?.push(url)
    if (url.includes('/x/web-interface/view')) {
      const payload = { ...VIEW_PAYLOAD, data: { ...VIEW_PAYLOAD.data, pic: options.pic ?? COVER_URL } }
      return jsonResponse(payload)
    }
    if (url === COVER_URL) return imageResponse(options.imageContentType ?? 'image/jpeg')
    throw new Error(`no fixture route for ${url}`)
  }
}

function makeCtx(bilibiliFetch: FetchLike): AppContext {
  const ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor, bilibiliFetch })
  db = ctx.db
  return ctx
}

/** 造假数据：SEU 课 / B 站课（带 bvid）/ 库内 BV 被改坏的课。 */
function seedLessons(ctx: AppContext): void {
  ctx.db.prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('c-seu', '电子电路', 'seu', NULL, '2026-09-20T00:00:00Z')").run()
  ctx.db.prepare("INSERT INTO lessons (id, course_id, title, source, fetched_at) VALUES ('l-seu', 'c-seu', '第5讲', 'seu', '2026-09-20T00:00:00Z')").run()
  ctx.db
    .prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('c-bili', '数据结构', 'bilibili', 'BV1tNpbekEht', '2026-09-20T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO lessons (id, course_id, title, source, bili_page, fetched_at) VALUES ('l-bili', 'c-bili', '第1讲', 'bilibili', 1, '2026-09-20T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('c-bad', '坏数据', 'bilibili', 'javascript:alert(1)', '2026-09-20T00:00:00Z')")
    .run()
  ctx.db.prepare("INSERT INTO lessons (id, course_id, title, source, fetched_at) VALUES ('l-bad', 'c-bad', '坏课', 'bilibili', '2026-09-20T00:00:00Z')").run()
}

function invoke(ctx: AppContext, channel: string, ...args: unknown[]): Promise<unknown> {
  registerIpc(ctx, ipc as never)
  return ipc.invoke(channel, ...args)
}

function readLogs(): string {
  const logsDir = join(dir, 'userdata', 'logs')
  if (!existsSync(logsDir)) return ''
  return readdirSync(logsDir)
    .filter((file) => file.endsWith('.log'))
    .map((file) => readFileSync(join(logsDir, file), 'utf8'))
    .join('\n')
}

describe('notes:backfillCover（批3, plan 2026-09-20, P1/D8）', () => {
  it('B 站课时：取图 → 落盘 → 写回 cover_path，notes:cover 读回同一张图', async () => {
    const calls: string[] = []
    const ctx = makeCtx(makeFetch({ calls }))
    seedLessons(ctx)
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-bili')) as { ok: boolean; value?: { coverPath: string } }
    expect(res.ok).toBe(true)
    expect(res.value?.coverPath.replace(/\\/g, '/')).toBe('attachments/l-bili/cover.jpg')
    expect(calls.some((url) => url.includes('/x/web-interface/view'))).toBe(true)
    const row = db.prepare('SELECT cover_path FROM lessons WHERE id = ?').get('l-bili') as { cover_path: string | null }
    expect(row.cover_path).toBe(res.value?.coverPath)
    // 落盘的是真的那张图（PNG 魔数），并且 notes:cover 能读回来。
    const cover = (await invoke(ctx, 'notes:cover', 'l-bili')) as { ok: boolean; value: string | null }
    expect(cover.value).toBe(`data:image/jpeg;base64,${PNG_BYTES.toString('base64')}`)
    expect(readLogs()).toContain('lesson cover backfilled: lesson=l-bili')
  })

  it('SEU 源：如实拒绝且一个请求都不发', async () => {
    const calls: string[] = []
    const ctx = makeCtx(makeFetch({ calls }))
    seedLessons(ctx)
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-seu')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('只有 B 站导入的课时能补取封面')
    expect(calls).toEqual([])
  })

  it('库内 BV 号被改坏：拒绝请求（纵深防御，库内值不外发）', async () => {
    const calls: string[] = []
    const ctx = makeCtx(makeFetch({ calls }))
    seedLessons(ctx)
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-bad')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('只有 B 站导入的课时能补取封面')
    expect(calls).toEqual([])
  })

  it('课时不存在：如实说明', async () => {
    const ctx = makeCtx(makeFetch())
    seedLessons(ctx)
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-missing')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('课时不存在')
  })

  it('取图失败：返回人话错误且不动库里既有的 cover_path', async () => {
    const ctx = makeCtx(makeFetch({ imageContentType: 'text/html' }))
    seedLessons(ctx)
    db.prepare("UPDATE lessons SET cover_path = 'attachments/l-bili/old.jpg' WHERE id = 'l-bili'").run()
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-bili')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('封面下载失败')
    const row = db.prepare('SELECT cover_path FROM lessons WHERE id = ?').get('l-bili') as { cover_path: string | null }
    expect(row.cover_path).toBe('attachments/l-bili/old.jpg')
  })

  it('视频没有封面：如实拒绝，不落空文件', async () => {
    const ctx = makeCtx(makeFetch({ pic: '' }))
    seedLessons(ctx)
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-bili')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('没有可用封面')
    const row = db.prepare('SELECT cover_path FROM lessons WHERE id = ?').get('l-bili') as { cover_path: string | null }
    expect(row.cover_path).toBeNull()
  })

  it('非法 lessonId 被 assertSafeId 拦在查询之前', async () => {
    const calls: string[] = []
    const ctx = makeCtx(makeFetch({ calls }))
    seedLessons(ctx)
    const res = (await invoke(ctx, 'notes:backfillCover', '../escape')) as { ok: boolean }
    expect(res.ok).toBe(false)
    expect(calls).toEqual([])
  })

  // 批3 评审补口: view 接口失败是最可能的一条（方案 §5 点名的风控），而 client 抛的是
  // 英文技术串、渲染层原样 toast——必须翻成人话，且不动既有封面。
  it('B 站风控（412）：人话错误，不带英文技术串，不动既有 cover_path', async () => {
    const ctx = makeCtx(async (url) => {
      if (url.includes('/x/web-interface/view')) {
        return { ...(await jsonResponse({})), ok: false, status: 412 }
      }
      throw new Error(`no fixture route for ${url}`)
    })
    seedLessons(ctx)
    db.prepare("UPDATE lessons SET cover_path = 'attachments/l-bili/old.jpg' WHERE id = 'l-bili'").run()
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-bili')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('限流')
    expect(res.error).not.toContain('risk control')
    const row = db.prepare('SELECT cover_path FROM lessons WHERE id = ?').get('l-bili') as { cover_path: string | null }
    expect(row.cover_path).toBe('attachments/l-bili/old.jpg')
  })

  it('连不上 B 站：人话错误且不带英文技术串', async () => {
    const ctx = makeCtx(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.bilibili.com')
    })
    seedLessons(ctx)
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-bili')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('连接 B 站失败')
    expect(res.error).not.toContain('ENOTFOUND')
  })

  it('响应不可用（payload 解析失败）：兜底人话，不带英文技术串', async () => {
    const ctx = makeCtx(async (url) => {
      if (url.includes('/x/web-interface/view')) return jsonResponse({ code: 0, data: { nothing: true } })
      throw new Error(`no fixture route for ${url}`)
    })
    seedLessons(ctx)
    const res = (await invoke(ctx, 'notes:backfillCover', 'l-bili')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('稍后重试')
    expect(res.error).not.toContain('payload unusable')
  })

  it('桥面有 backfillCover 且只吃 lessonId（preload 与 bridge.ts 同步）', async () => {
    const fs = await import('fs')
    const preloadSource = fs.readFileSync('src/preload/index.ts', 'utf8')
    expect(preloadSource).toContain("ipcRenderer.invoke('notes:backfillCover', lessonId)")
  })
})

describe('bilibili:import 的封面成败日志（批3, P1）', () => {
  it('封面抓到并落盘 → cover=ok', async () => {
    const ctx = makeCtx(makeFetch())
    const res = (await invoke(ctx, 'bilibili:import', { bvid: 'BV1tNpbekEht', pages: [1] })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(readLogs()).toContain('bilibili import: bili-BV1tNpbekEht pages=1 cover=ok')
    const row = db.prepare('SELECT cover_path FROM lessons WHERE id = ?').get('bili-BV1tNpbekEht-P1') as { cover_path: string | null }
    expect(row.cover_path).not.toBeNull()
  })

  it('平台没给封面 → cover=skipped', async () => {
    const ctx = makeCtx(makeFetch({ pic: '' }))
    const res = (await invoke(ctx, 'bilibili:import', { bvid: 'BV1tNpbekEht', pages: [1] })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(readLogs()).toContain('bilibili import: bili-BV1tNpbekEht pages=1 cover=skipped')
  })

  it('抓到图但存不下 → cover=fetched-failed（导入本身照常成功）', async () => {
    const ctx = makeCtx(makeFetch({ imageContentType: 'text/html' }))
    const res = (await invoke(ctx, 'bilibili:import', { bvid: 'BV1tNpbekEht', pages: [1] })) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(readLogs()).toContain('bilibili import: bili-BV1tNpbekEht pages=1 cover=fetched-failed')
    const row = db.prepare('SELECT cover_path FROM lessons WHERE id = ?').get('bili-BV1tNpbekEht-P1') as { cover_path: string | null }
    expect(row.cover_path).toBeNull()
  })
})
