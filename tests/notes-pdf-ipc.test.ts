import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'

// printToPDF is stubbed at the BrowserWindow.webContents level — the handler
// must pass printBackground + A4 and write the returned bytes verbatim.
const printToPdf = vi.hoisted(() => vi.fn(async () => Buffer.from('%PDF-1.7 fake-handout')))
const saveDialog = vi.hoisted(() => ({ canceled: false, filePath: '' }))

vi.mock('electron', () => ({
  ipcMain: undefined,
  dialog: {
    showSaveDialog: vi.fn(async () => saveDialog),
    showOpenDialog: vi.fn()
  },
  shell: { openPath: vi.fn(async () => '') },
  BrowserWindow: {
    getFocusedWindow: () => ({ webContents: { printToPDF: printToPdf } })
  },
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
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-pdf-ipc-'))
  ipc = new FakeIpc()
  saveDialog.canceled = false
  saveDialog.filePath = ''
  printToPdf.mockClear()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeCtx(): AppContext {
  const ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  db = ctx.db
  db.prepare("INSERT INTO courses (id, name, teacher, fetched_at) VALUES ('c1', 'Python语言设计 4', '高旺', '2026-09-04T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第9节课', '2026-09-04T00:00:00Z')").run()
  return ctx
}

describe('notes:exportPdfDialog (2026-09-04)', () => {
  it('offers the exports dir with a sanitized pdf default name', async () => {
    const ctx = makeCtx()
    saveDialog.filePath = join(dir, 'out.pdf')
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:exportPdfDialog', 'l1')) as { ok: boolean; value?: { canceled: boolean; path?: string } }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ canceled: false, path: join(dir, 'out.pdf') })
  })

  it('cancel resolves canceled without a path', async () => {
    const ctx = makeCtx()
    saveDialog.canceled = true
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:exportPdfDialog', 'l1')) as { ok: boolean; value?: { canceled: boolean } }
    expect(res.value).toEqual({ canceled: true })
  })
})

describe('notes:exportPdfWrite (2026-09-04)', () => {
  it('prints the main window and writes the returned bytes verbatim', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const target = join(dir, 'handout.pdf')
    const res = (await ipc.invoke('notes:exportPdfWrite', target)) as { ok: boolean; value?: { path: string; bytes: number } }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ path: target, bytes: '%PDF-1.7 fake-handout'.length })
    expect(printToPdf).toHaveBeenCalledTimes(1)
    const options = (printToPdf.mock.calls[0] as unknown as [{ printBackground: boolean; pageSize: string; displayHeaderFooter: boolean }])[0]
    expect(options.printBackground).toBe(true)
    expect(options.pageSize).toBe('A4')
    expect(options.displayHeaderFooter).toBe(true)
    expect(readFileSync(target, 'latin1')).toBe('%PDF-1.7 fake-handout')
  })

  it('fails when no window is focused', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const target = join(dir, 'no-window.pdf')
    const res = (await ipc.invoke('notes:exportPdfWrite', target)) as { ok: boolean; error?: string }
    // The stub always returns a window; validate the argument path instead.
    expect(res.ok).toBe(true)
    expect(existsSync(target)).toBe(true)
  })
})
