import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'
import { noteToMarkdown } from '../src/shared/notes/markdown'

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
    return fn({}, ...args)
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

  it('settings:chooseLibrary returns canceled without migrating', async () => {
    const ctx = makeCtx()
    openDialog.canceled = true
    const res = await invoke(ctx, 'settings:chooseLibrary') as { ok: true; value: { canceled: boolean } }
    expect(res.value.canceled).toBe(true)
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
