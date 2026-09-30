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
import { FEEDBACK_FORM_URL } from '../src/shared/feedback'


/**
 * 声明批6（plan 2026-09-11 compliance-disclosure）: 反馈通道的 IPC 边界。
 *
 * 这条通道的红线是「只给入口、不上报」，所以测试的重点不是功能多，而是**边界**：
 *  · 打开外链的地址只能来自 main 的常量，渲染层传什么都不算；
 *  · 诊断文本出门前必须过 redact（它会被用户粘到外部表单里）；
 *  · 任务不存在时诚实说明，而不是抛错或印 null。
 */

// 批8 (audit 2026-09-28, H25): electron 桩提到共享 helper——14 份拷贝收成一份。
// 反馈通道的断言要摸到 openExternal 这个具体桩，故在共享桩上就地覆写。
const openExternal = vi.hoisted(() => vi.fn(async (_url: string) => undefined))

vi.mock('electron', () => {
  const electron = stubElectron()
  electron.shell.openExternal = openExternal
  return electron
})

// 批1（契约有意变更）：E1 校验从「任意 file:// 放行」改为「只认启动时注入的
// 应用 renderer URL」——FakeIpc 伪装的调用方 URL 现在必须显式注入。
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
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-feedback-'))
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

/** Seed a course + lesson + failed task the way the pipeline would. */
function seedFailedTask(ctx: AppContext, errorMessage: string): string {
  ctx.db.prepare("INSERT INTO courses (id, name, tecl_id, tecl_code, source, fetched_at) VALUES ('c1', '信号与系统', 't', 'k', 'seu', '2026-09-11T09:00:00Z')").run()
  ctx.db.prepare("INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES ('l1', 'c1', '第3讲', '0', '2026-09-11T09:00:00Z')").run()
  ctx.db
    .prepare("INSERT INTO tasks (id, lesson_id, state, failed_stage, error_message, created_at, updated_at) VALUES ('t1', 'l1', 'failed', 'downloading_video', ?, '2026-09-11T09:00:00Z', '2026-09-11T09:02:00Z')")
    .run(errorMessage)
  return 't1'
}

describe('feedback IPC（声明批6：只给入口、不上报）', () => {
  it('feedback:openForm 用的是 main 自己的常量，渲染层传的地址一律不算', async () => {
    const ctx = makeCtx()
    // A forged argument must be ignored — otherwise this becomes an
    // openExternal injection hole (AGENTS.md 安全红线).
    await invoke(ctx, 'feedback:openForm', 'https://evil.example.com/steal')
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(FEEDBACK_FORM_URL)
    expect(String(openExternal.mock.calls[0]?.[0] ?? '')).not.toContain('evil')
  })

  it('反馈表是腾讯文档收集表形态（可匿名填写，测试用户无权限卡点）', () => {
    expect(FEEDBACK_FORM_URL.startsWith('https://')).toBe(true)
    expect(FEEDBACK_FORM_URL).toContain('docs.qq.com/form/page/')
  })

  it('feedback:diagnostics 给出可定位问题的字段', async () => {
    const ctx = makeCtx()
    const taskId = seedFailedTask(ctx, '拉流失败：连接被重置')
    const res = (await invoke(ctx, 'feedback:diagnostics', taskId)) as { ok: true; value: { text: string } }
    expect(res.ok).toBe(true)
    const text = res.value.text
    expect(text).toContain('0.0.0-test')
    expect(text).toContain('信号与系统')
    expect(text).toContain('第3讲')
    expect(text).toContain('downloading_video')
    expect(text).toContain('拉流失败：连接被重置')
    expect(text).toContain(join(dir, 'userdata', 'logs'))
  })

  it('诊断文本出门前过 redact——它会被用户粘到外部表单里', async () => {
    const ctx = makeCtx()
    // A dirty failure reason, as if something upstream had echoed a URL+key.
    const taskId = seedFailedTask(ctx, 'download failed: https://dncvsvod.seu.edu.cn/a.mp4?auth_key=SECRET123 (cookie=SESSDATA%3Dx)')
    const res = (await invoke(ctx, 'feedback:diagnostics', taskId)) as { ok: true; value: { text: string } }
    expect(res.value.text).not.toContain('SECRET123')
    expect(res.value.text).toContain('[REDACTED]')
  })

  it('任务不存在时如实说明，不抛错也不印 null', async () => {
    const ctx = makeCtx()
    const res = (await invoke(ctx, 'feedback:diagnostics', 't-missing')) as { ok: true; value: { text: string } }
    expect(res.ok).toBe(true)
    expect(res.value.text).toContain('未找到该任务')
    expect(res.value.text).not.toContain('null')
  })

  it('桥面只有「打开」与「取文本」两个方法——没有任何上报通道', async () => {
    // 红线「只给入口、不上报」的自动化形式：真要在反馈通道里加自动发送，
    // 这个断言会先红，逼着人回来看这条红线。
    const preloadSource = await import('fs').then((fs) => fs.readFileSync('src/preload/index.ts', 'utf8'))
    // 精确切 feedback 组：从 `  feedback: {` 到下一处两空格缩进的 `},` 收尾。
    // （曾切到文件末尾——后续新增的组会被卷进来，那时这条红线断言就失真了。）
    const rest = preloadSource.slice(preloadSource.indexOf('  feedback: {'))
    const feedbackBlock = rest.slice(0, rest.indexOf('\n  },'))
    const methods = [...feedbackBlock.matchAll(/^\s{4}(\w+):/gm)].map((matched) => matched[1])
    expect(methods).toEqual(['openForm', 'diagnostics'])
    // 顺便：通道里不出现常见的上报词汇。
    for (const word of ['upload', 'report(', 'telemetry', 'track', 'sendBeacon']) {
      expect(feedbackBlock).not.toContain(word)
    }
  })
})
