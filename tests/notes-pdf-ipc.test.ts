import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Db } from '../src/main/db/open'
import { createContext, type AppContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'

// printToPDF is stubbed at the BrowserWindow.webContents level — the handler
// must pass printBackground + A4 and write the returned bytes verbatim.
const printToPdf = vi.hoisted(() => vi.fn(async () => Buffer.from('%PDF-1.7 fake-handout')))
const saveDialog = vi.hoisted(() => ({ canceled: false, filePath: '' }))
const showItemInFolder = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: undefined,
  dialog: {
    showSaveDialog: vi.fn(async () => saveDialog),
    showOpenDialog: vi.fn()
  },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder },
  BrowserWindow: {
    getFocusedWindow: () => ({ webContents: { printToPDF: printToPdf } })
  },
  WebContents: undefined
}))

// 批1（契约有意变更）：E1 校验从「任意 file:// 放行」改为「只认启动时注入的
// 应用 renderer URL」——FakeIpc 伪装的调用方 URL 现在必须显式注入。
setAppRendererOrigin('file:///app/index.html')

class FakeIpc {
  readonly handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, fn)
  }
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    // E1 (review): handlers verify the sender frame — pose as the app UI.
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
  it('offers the exports dir with a sanitized pdf default name and a write token (E3)', async () => {
    const ctx = makeCtx()
    saveDialog.filePath = join(dir, 'out.pdf')
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:exportPdfDialog', 'l1')) as {
      ok: boolean
      value?: { canceled: boolean; path?: string; token?: string }
    }
    expect(res.ok).toBe(true)
    expect(res.value?.canceled).toBe(false)
    expect(res.value?.path).toBe(join(dir, 'out.pdf'))
    // E3: the token is the only key that unlocks the write step.
    expect(typeof res.value?.token).toBe('string')
    expect(res.value?.token?.length).toBeGreaterThan(10)
  })

  it('cancel resolves canceled without a path', async () => {
    const ctx = makeCtx()
    saveDialog.canceled = true
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:exportPdfDialog', 'l1')) as { ok: boolean; value?: { canceled: boolean } }
    expect(res.value).toEqual({ canceled: true })
  })
})

describe('notes:revealFile (2026-09-04)', () => {
  it('reveals the exported file in Explorer', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const target = join(ctx.exportsDir(), 'handout.pdf')
    const res = (await ipc.invoke('notes:revealFile', target)) as { ok: boolean; value?: boolean }
    expect(res.ok).toBe(true)
    expect(res.value).toBe(true)
    expect(showItemInFolder).toHaveBeenCalledWith(target)
  })

  it('rejects a path outside the exports/attachments roots (review E4)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:revealFile', join(dir, 'secrets.txt'))) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('只能打开')
  })

  it('rejects a non-string path', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:revealFile', 123)) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
  })
})

describe('notes:exportPdfWrite (2026-09-04)', () => {
  it('prints the main window and writes the dialog-confirmed path via the one-shot token (E3)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const target = join(ctx.exportsDir(), 'handout.pdf')
    saveDialog.filePath = target
    const dialog = (await ipc.invoke('notes:exportPdfDialog', 'l1')) as { ok: boolean; value?: { token?: string } }
    expect(dialog.ok).toBe(true)
    const res = (await ipc.invoke('notes:exportPdfWrite', dialog.value?.token)) as {
      ok: boolean
      value?: { path: string; bytes: number }
    }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ path: target, bytes: '%PDF-1.7 fake-handout'.length })
    expect(printToPdf).toHaveBeenCalledTimes(1)
    const options = (printToPdf.mock.calls[0] as unknown as [{ printBackground: boolean; pageSize: string; displayHeaderFooter: boolean }])[0]
    expect(options.printBackground).toBe(true)
    expect(options.pageSize).toBe('A4')
    expect(options.displayHeaderFooter).toBe(true)
    expect(readFileSync(target, 'latin1')).toBe('%PDF-1.7 fake-handout')
  })

  it('refuses an unknown token instead of writing an attacker-chosen path (E3)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const res = (await ipc.invoke('notes:exportPdfWrite', 'made-up-token')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('导出会话')
    expect(printToPdf).not.toHaveBeenCalled()
  })

  it('a token is one-shot: the second write with it is refused (E3)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const target = join(ctx.exportsDir(), 'handout.pdf')
    saveDialog.filePath = target
    const dialog = (await ipc.invoke('notes:exportPdfDialog', 'l1')) as { ok: boolean; value?: { token?: string } }
    await ipc.invoke('notes:exportPdfWrite', dialog.value?.token)
    const second = (await ipc.invoke('notes:exportPdfWrite', dialog.value?.token)) as { ok: boolean; error?: string }
    expect(second.ok).toBe(false)
    expect(printToPdf).toHaveBeenCalledTimes(1)
  })
})
