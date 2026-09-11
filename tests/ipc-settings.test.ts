import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'
import { noteToMarkdown } from '../src/shared/notes/markdown'
import { readLibraryPointer } from '../src/main/library/pointer'
import { getSetting, SETTINGS_KEYS } from '../src/main/settings/store'
import { DISCLAIMER_TEXT_VERSION } from '../src/shared/disclaimer'
import { COPYRIGHT_NOTICE_VERSION } from '../src/shared/copyright-notice'

// Electron dialogs are user-facing; tests stub them and assert the wiring.
const saveDialog = vi.hoisted(() => ({ canceled: false, filePath: '' }))
const openDialog = vi.hoisted(() => ({ canceled: false, filePaths: [] as string[] }))

vi.mock('electron', () => ({
  ipcMain: undefined,
  dialog: {
    showSaveDialog: vi.fn(async () => saveDialog),
    showOpenDialog: vi.fn(async () => openDialog)
  },
  shell: { openPath: vi.fn(async () => '') },
  BrowserWindow: { getFocusedWindow: () => null },
  app: { getVersion: () => '0.0.0-test' },
  WebContents: undefined
}))

class FakeIpc {
  readonly handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, fn)
  }
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    // E1 (review): handlers verify the sender frame - pose as the app UI.
    return fn({ senderFrame: { url: 'file:///app/index.html' } }, ...args)
  }

  async invokeFrom(url: string, channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    return fn({ senderFrame: { url } }, ...args)
  }
}

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

  it('settings:openPath reports the failure instead of swallowing it (health audit 2026-09-12)', async () => {
    const { shell } = await import('electron')
    const ctx = makeCtx()
    ;(shell.openPath as ReturnType<typeof vi.fn>).mockResolvedValueOnce('EPERM: operation not permitted')
    const res = await invoke(ctx, 'settings:openPath', 'library') as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('资料库')
    expect(res.error).toContain('EPERM')
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
