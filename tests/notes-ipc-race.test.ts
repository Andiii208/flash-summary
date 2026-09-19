import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'
import { saveNoteVersion } from '../src/main/notes/summarize'
import { parseNote } from '../src/shared/notes/schema'

vi.mock('electron', () => ({
  ipcMain: undefined,
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
  BrowserWindow: { getFocusedWindow: () => null },
  WebContents: undefined
}))

setAppRendererOrigin('file:///app/index.html')

class FakeIpc {
  readonly handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, fn)
  }
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    return fn({ senderFrame: { url: 'file:///app/index.html' } }, ...args)
  }
}

const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

let dir: string
let ipc: FakeIpc
let ctx: AppContext

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-notes-race-'))
  ipc = new FakeIpc()
  ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  ctx.db
    .prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-19T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-19T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'p', 'm', '2026-09-19T00:00:00Z')")
    .run(JSON.stringify([{ at: 120, text: '本讲讲的是梯度下降与学习率的关系。' }]))
  ctx.db
    .prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', '测试', 'http://x', 'k', '2026-09-19T00:00:00Z')")
    .run()
  ctx.db
    .prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')")
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

/** Seed the latest note the way a finished task would have. */
function seedLatestNote(): void {
  saveNoteVersion(
    ctx.db,
    'l1',
    parseNote(
      JSON.stringify({
        overview: '本讲概览',
        knowledgeTree: { title: 'root', children: [{ title: 'child', children: [] }] },
        timeline: [{ at: 120, title: 't', detail: 'd', evidence: [{ kind: 'keyframe', ref: 'kf:kf-1' }] }],
        methodology: '方法'
      })
    ),
    'mimo-v2.5'
  )
}

describe('polish × regenerate 互斥 (批5)', () => {
  it('polish 在飞时 regenerate 被拒，且不插新版本', async () => {
    seedLatestNote()
    let releasePolish: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      releasePolish = r
    })
    let regenerateChatCalls = 0
    // polish 的模型调用挂起，模拟一次长耗时润色。
    ctx.chatFor = (() => ({
      chatJson: async () => {
        await gate
        return JSON.stringify({
          overview: '润色后的更完整概览',
          knowledgeTree: { title: 'root', children: [{ title: 'child', children: [] }] },
          timeline: [{ at: 120, title: 't', detail: 'd', evidence: [{ kind: 'keyframe', ref: 'kf:kf-1' }] }],
          methodology: '方法'
        })
      }
    })) as unknown as AppContext['chatFor']

    const polish = invoke('notes:polish', 'l1', { tags: ['too_brief'], text: '' })
    // Let polish park on its hanging model call.
    await new Promise((r) => setTimeout(r, 10))

    // regenerate 的类型守卫（队列表/在途表）都过得了，只有 in-flight 登记拦得住它。
    ctx.chatFor = (() => ({
      chatJson: async () => {
        regenerateChatCalls += 1
        return '{}'
      }
    })) as unknown as AppContext['chatFor']
    const rejected = (await invoke('notes:regenerate', 'l1')) as { ok: boolean; error?: string }
    expect(rejected.ok).toBe(false)
    expect(String(rejected.error)).toContain('在进行中')
    expect(regenerateChatCalls).toBe(0)

    // 被拒期间没有第二个版本落库。
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n).toBe(1)

    releasePolish!()
    const polished = (await polish) as { ok: boolean }
    expect(polished.ok).toBe(true)
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n).toBe(2)
  })
})
