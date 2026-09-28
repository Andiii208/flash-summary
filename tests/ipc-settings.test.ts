// 批8 (audit 2026-09-28, H25): FakeIpc / electron 桩提到共享 helper（12 份拷贝收成一份）。
import { FakeIpc } from './helpers/fake-ipc'
import { stubElectron } from './helpers/electron-mock'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'
import { noteToMarkdown } from '../src/shared/notes/markdown'
import { readLibraryPointer } from '../src/main/library/pointer'
import { getSetting, SETTINGS_KEYS } from '../src/main/settings/store'
import { DISCLAIMER_TEXT_VERSION } from '../src/shared/disclaimer'
import { COPYRIGHT_NOTICE_VERSION } from '../src/shared/copyright-notice'
import { AUTHOR_GITHUB_URL } from '../src/shared/author'


// 批8 (audit 2026-09-28, H25): electron 桩提到共享 helper——14 份拷贝收成一份。
// Electron dialogs are user-facing; tests stub them and assert the wiring.
// 对话框返回值沿用原有夹具对象（测试按 beforeEach 复位、按用例改写）。
const saveDialog = vi.hoisted(() => ({ canceled: false, filePath: '' }))
const openDialog = vi.hoisted(() => ({ canceled: false, filePaths: [] as string[] }))

vi.mock('electron', () => {
  const electron = stubElectron()
  electron.dialog.showSaveDialog = vi.fn(async () => saveDialog)
  electron.dialog.showOpenDialog = vi.fn(async () => openDialog)
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
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-settings-ipc-'))
  ipc = new FakeIpc()
  saveDialog.canceled = false
  saveDialog.filePath = ''
  openDialog.canceled = false
  openDialog.filePaths = []
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

describe('settings IPC (U3)', () => {
  it('settings:get reports effective defaults', async () => {
    const ctx = makeCtx()
    const res = await invoke(ctx, 'settings:get') as { ok: true; value: { libraryRoot: string; cacheDir: string; theme: string } }
    expect(res.value.cacheDir).toBe(join(dir, 'cache'))
    expect(res.value.theme).toBe('auto')
  })

  it('settings:setCacheDir persists and returns the effective dir', async () => {
    const ctx = makeCtx()
    const custom = join(dir, 'custom-cache')
    const res = await invoke(ctx, 'settings:setCacheDir', custom) as { ok: true; value: { cacheDir: string } }
    expect(res.value.cacheDir).toBe(custom)
    const again = await invoke(ctx, 'settings:get') as { ok: true; value: { cacheDir: string } }
    expect(again.value.cacheDir).toBe(custom)
  })

  it('批2: settings:setCacheDir 拒绝 UNC 网络路径（任务产物落盘处不能随网络漂移）', async () => {
    const ctx = makeCtx()
    for (const hostile of ['\\\\nas\\share\\cache', '//nas/share/cache']) {
      const res = await invoke(ctx, 'settings:setCacheDir', hostile) as { ok: boolean; error?: string }
      expect(res.ok, hostile).toBe(false)
      expect(res.error, hostile).toContain('UNC')
    }
  })

  // 批1 (plan 2026-09-20, P21): cacheDir 承接任务产物，taskDir 每次调用重新
  // join——跑到一半换根会把产物劈到新旧两处，旧目录再也没有入口回收。
  // 守卫与 chooseLibrary 同款：有任务在跑/排队/未完成（崩溃留下的可续跑行）
  // 就拒绝更换。
  it('批1 (P21): settings:setCacheDir 有未完成任务时被拒，且不动已保存的设置', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-20T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第1讲', '2026-09-20T00:00:00Z')").run()
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t-live', 'l1', 'transcribing', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')").run()

    const res = (await invoke(ctx, 'settings:setCacheDir', join(dir, 'new-cache'))) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    // 验收项要的是「提示先取消/清理」这半边——只断言含「任务」二字的话，任何
    // 改稿（比如删掉下一步动作）都能保持全绿（批1 二次评审点名）。
    expect(res.error).toBe('有任务在运行、排队或未完成，请先取消或清理任务后再更换缓存目录')
    expect(res.error).toContain('请先取消或清理任务后再更换缓存目录')
    // 拒绝就是拒绝：设置保持原值（默认 cache 目录），没有被半途改写。
    const after = (await invoke(ctx, 'settings:get')) as { ok: true; value: { cacheDir: string } }
    expect(after.value.cacheDir).toBe(join(dir, 'cache'))
  })

  it('批1 (P21): 崩溃留下的非终态行同样挡住更换（与 chooseLibrary 口径一致）', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-20T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第1讲', '2026-09-20T00:00:00Z')").run()
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t-stuck', 'l1', 'downloading_video', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')").run()

    const res = (await invoke(ctx, 'settings:setCacheDir', join(dir, 'new-cache'))) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toBe('有任务在运行、排队或未完成，请先取消或清理任务后再更换缓存目录')
  })

  it('批1 (P21): 终态任务（succeeded/failed）不挡更换——产物已收口，换根是安全的', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-20T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第1讲', '2026-09-20T00:00:00Z')").run()
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t-ok', 'l1', 'succeeded', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')").run()
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t-bad', 'l1', 'failed', '2026-09-20T00:00:00Z', '2026-09-20T00:00:00Z')").run()

    const target = join(dir, 'new-cache')
    const res = (await invoke(ctx, 'settings:setCacheDir', target)) as { ok: true; value: { cacheDir: string } }
    expect(res.ok).toBe(true)
    expect(res.value.cacheDir).toBe(target)
  })

  it('settings:setTheme rejects an invalid theme', async () => {
    const ctx = makeCtx()
    const res = await invoke(ctx, 'settings:setTheme', 'neon') as { ok: false; error: string }
    expect(res.ok).toBe(false)
  })

  it('settings:chooseLibrary migrates and flags restart', async () => {
    const ctx = makeCtx()
    const dest = join(dir, 'new-library')
    openDialog.filePaths = [dest]
    const res = await invoke(ctx, 'settings:chooseLibrary') as { ok: true; value: { libraryRoot: string; restartRequired: boolean } }
    expect(res.value.libraryRoot).toBe(dest)
    expect(res.value.restartRequired).toBe(true)
    expect(existsSync(join(dest, 'app.db'))).toBe(true)
  })

  it('settings:chooseLibrary writes the userData pointer (review C1)', async () => {
    const ctx = makeCtx()
    const dest = join(dir, 'new-library')
    openDialog.filePaths = [dest]
    const res = await invoke(ctx, 'settings:chooseLibrary') as { ok: boolean; value?: { restartRequired: boolean } }
    expect(res.ok).toBe(true)
    // The next launch opens THIS root via the pointer — not a settings row
    // buried in the old library that nobody read.
    expect(readLibraryPointer(join(dir, 'userdata'))).toBe(dest)
  })

  it('settings:chooseLibrary refuses while tasks are running or queued (review C3)', async () => {
    const ctx = makeCtx()
    const dest = join(dir, 'never-library')
    openDialog.filePaths = [dest]
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-01T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第1讲', '2026-09-01T00:00:00Z')").run()
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t-live', 'l1', 'transcribing', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')").run()
    const res = await invoke(ctx, 'settings:chooseLibrary') as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('有任务')
    expect(existsSync(dest)).toBe(false)
  })

  it('settings:chooseLibrary reports per-entry copy progress (review C3)', async () => {
    const ctx = makeCtx()
    const dest = join(dir, 'progress-library')
    openDialog.filePaths = [dest]
    mkdirSync(join(dir, 'attachments', 'l1'), { recursive: true })
    writeFileSync(join(dir, 'attachments', 'l1', 'kf.jpg'), 'x')
    const sent: Array<{ channel: string; payload: unknown }> = []
    registerIpc(ctx, ipc as never, { sender: { send: (channel, payload) => sent.push({ channel, payload }) } })
    const res = await ipc.invoke('settings:chooseLibrary') as { ok: boolean }
    expect(res.ok).toBe(true)
    const events = sent.filter((s) => s.channel === 'library:migrationProgress') as Array<{ payload: { copied: number; total: number } }>
    expect(events[events.length - 1]?.payload).toEqual({ copied: 1, total: 1 })
  })

  it('settings:chooseLibrary returns canceled without migrating', async () => {
    const ctx = makeCtx()
    openDialog.canceled = true
    const res = await invoke(ctx, 'settings:chooseLibrary') as { ok: true; value: { canceled: boolean } }
    expect(res.value.canceled).toBe(true)
  })

  // C10: 缓存目录选择器。此前这个 handler 单测 smoke 双零（批7 H14）——用户点
  // 「选择目录」拿到什么全凭 IPC 信封说话，而测试一句都没验证过。
  it('settings:chooseCacheDir returns the picked path (C10)', async () => {
    const ctx = makeCtx()
    const dest = join(dir, 'picked-cache')
    openDialog.filePaths = [dest]
    const res = await invoke(ctx, 'settings:chooseCacheDir') as { ok: true; value: { canceled: boolean; path?: string } }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ canceled: false, path: dest })
    // 只把路径带回草稿输入，不落设置（setCacheDir 才是持久化入口）。
    const settings = await invoke(ctx, 'settings:get') as { ok: true; value: { cacheDir: string } }
    expect(settings.value.cacheDir).toBe(join(dir, 'cache'))
  })

  it('settings:chooseCacheDir reports canceled without a path', async () => {
    const ctx = makeCtx()
    openDialog.canceled = true
    const res = await invoke(ctx, 'settings:chooseCacheDir') as { ok: true; value: { canceled: boolean; path?: string } }
    expect(res.value.canceled).toBe(true)
    expect(res.value.path).toBeUndefined()
  })

  it('settings:chooseCacheDir surfaces a dialog failure as an err envelope', async () => {
    const ctx = makeCtx()
    const { dialog } = await import('electron')
    ;(dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('dialog blew up'))
    const res = await invoke(ctx, 'settings:chooseCacheDir') as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('dialog blew up')
  })

  it('settings:openPath reports the failure instead of swallowing it (health audit 2026-09-12)', async () => {
    const { shell } = await import('electron')
    const ctx = makeCtx()
    ;(shell.openPath as ReturnType<typeof vi.fn>).mockResolvedValueOnce('EPERM: operation not permitted')
    const res = await invoke(ctx, 'settings:openPath', 'library') as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('资料库')
    expect(res.error).toContain('EPERM')
  })

  // 2026-09-21: 作者 GitHub 主页。与 feedback:openForm 同一条红线——地址只在
  // main 侧，渲染层传什么参数都不算（否则就是 openExternal 注入洞）。
  it('settings:openAuthor 用的是 main 自己的常量，渲染层传的地址一律不算', async () => {
    const { shell } = await import('electron')
    const ctx = makeCtx()
    ;(shell.openExternal as ReturnType<typeof vi.fn>).mockClear()
    await invoke(ctx, 'settings:openAuthor', 'https://evil.example.com/steal')
    expect(shell.openExternal).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).toHaveBeenCalledWith(AUTHOR_GITHUB_URL)
    expect(String((shell.openExternal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '')).not.toContain('evil')
  })
})

describe('notes:exportMarkdown (U3)', () => {
  it('writes the markdown to the chosen path', async () => {
    const ctx = makeCtx()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-01T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第1讲', '2026-09-01T00:00:00Z')").run()
    const note = {
      overview: '概述',
      knowledgeTree: { title: '根', children: [] },
      timeline: [],
      concepts: [],
      formulasAndSteps: [],
      methodology: '方法论',
      examCues: [],
      questionsAndGaps: [],
      quiz: [],
      transcriptRefs: [],
      evidence: []
    }
    db.prepare("INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES ('n1', 'l1', 1, ?, 'p', 'm', '2026-09-01T00:00:00Z')").run(JSON.stringify(note))

    const outPath = join(dir, 'export.md')
    saveDialog.filePath = outPath
    const res = await invoke(ctx, 'notes:exportMarkdown', 'l1') as { ok: true; value: { canceled: boolean; path: string } }
    expect(res.value.canceled).toBe(false)
    expect(res.value.path).toBe(outPath)
    const content = readFileSync(outPath, 'utf8')
    // 批D: the in-file title is the full course-teacher-lesson name.
    expect(content).toContain(noteToMarkdown(note as never, '课程 - 第1讲').slice(0, 40))
  })

  it('fails when the lesson has no note yet', async () => {
    const ctx = makeCtx()
    const res = await invoke(ctx, 'notes:exportMarkdown', 'l-missing') as { ok: false; error: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('尚无笔记')
  })
})

describe('声明批2 — 使用须知同意状态（settings IPC）', () => {
  it('settings:get reports the consent gate as unsatisfied on a fresh library', async () => {
    const ctx = makeCtx()
    const res = await invoke(ctx, 'settings:get') as { ok: true; value: { disclaimerVersion: number; disclaimerAccepted: boolean } }
    expect(res.value.disclaimerVersion).toBe(DISCLAIMER_TEXT_VERSION)
    // Fresh library: nothing recorded, so the gate must be closed (fail-closed).
    expect(res.value.disclaimerAccepted).toBe(false)
  })

  it('settings:acceptDisclaimer records the shared text version and opens the gate', async () => {
    const ctx = makeCtx()
    const accepted = await invoke(ctx, 'settings:acceptDisclaimer') as { ok: true; value: { version: number } }
    expect(accepted.value.version).toBe(DISCLAIMER_TEXT_VERSION)

    const res = await invoke(ctx, 'settings:get') as { ok: true; value: { disclaimerAccepted: boolean } }
    expect(res.value.disclaimerAccepted).toBe(true)
    // Persisted under the shared key, so it survives a context rebuild.
    expect(getSetting(ctx.db, SETTINGS_KEYS.disclaimerAcceptedVersion, '')).toBe(String(DISCLAIMER_TEXT_VERSION))
  })

  it('re-opens the gate when the accepted version is older than the shipped text', async () => {
    const ctx = makeCtx()
    await invoke(ctx, 'settings:acceptDisclaimer')
    // Simulate a previously accepted, older text version.
    ctx.setSetting(SETTINGS_KEYS.disclaimerAcceptedVersion, String(DISCLAIMER_TEXT_VERSION - 1))

    const res = await invoke(ctx, 'settings:get') as { ok: true; value: { disclaimerAccepted: boolean } }
    expect(res.value.disclaimerAccepted).toBe(false)
  })

  it('ignores a renderer-supplied version — acceptDisclaimer takes no argument', async () => {
    const ctx = makeCtx()
    // A hand-crafted call with a bogus version must not be honoured: the
    // version comes from main's own constant.
    await invoke(ctx, 'settings:acceptDisclaimer', '999', 'forged')
    expect(getSetting(ctx.db, SETTINGS_KEYS.disclaimerAcceptedVersion, '')).toBe(String(DISCLAIMER_TEXT_VERSION))
  })
})

describe('声明批4 — 导出前版权提醒的免除（settings IPC）', () => {
  it('新库默认仍在提醒（未免除）', async () => {
    const ctx = makeCtx()
    const res = await invoke(ctx, 'settings:get') as { ok: true; value: { copyrightNoticeVersion: number; copyrightNoticeOptOut: boolean } }
    expect(res.value.copyrightNoticeVersion).toBe(COPYRIGHT_NOTICE_VERSION)
    expect(res.value.copyrightNoticeOptOut).toBe(false)
  })

  it('settings:optOutCopyrightNotice 记下文本版本，之后不再提醒', async () => {
    const ctx = makeCtx()
    const optOut = await invoke(ctx, 'settings:optOutCopyrightNotice') as { ok: true; value: { version: number } }
    expect(optOut.value.version).toBe(COPYRIGHT_NOTICE_VERSION)
    expect(getSetting(ctx.db, SETTINGS_KEYS.copyrightNoticeVersion, '')).toBe(String(COPYRIGHT_NOTICE_VERSION))

    const res = await invoke(ctx, 'settings:get') as { ok: true; value: { copyrightNoticeOptOut: boolean } }
    expect(res.value.copyrightNoticeOptOut).toBe(true)
  })

  it('免除的是「文本版本」：文案改版后提醒会回来一次', async () => {
    const ctx = makeCtx()
    await invoke(ctx, 'settings:optOutCopyrightNotice')
    // Simulate having opted out of an older revision of the notice text.
    ctx.setSetting(SETTINGS_KEYS.copyrightNoticeVersion, String(COPYRIGHT_NOTICE_VERSION - 1))

    const res = await invoke(ctx, 'settings:get') as { ok: true; value: { copyrightNoticeOptOut: boolean } }
    expect(res.value.copyrightNoticeOptOut).toBe(false)
  })

  it('两个「不再提示」互不干扰（使用须知 / 导出提醒）', async () => {
    const ctx = makeCtx()
    await invoke(ctx, 'settings:optOutCopyrightNotice')
    const res = await invoke(ctx, 'settings:get') as { ok: true; value: { disclaimerAccepted: boolean; copyrightNoticeOptOut: boolean } }
    // 免除导出提醒不等于同意了使用须知——两条同意各自独立。
    expect(res.value.copyrightNoticeOptOut).toBe(true)
    expect(res.value.disclaimerAccepted).toBe(false)
  })
})
