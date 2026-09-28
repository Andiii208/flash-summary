// 批8 (audit 2026-09-28, H25): FakeIpc / electron 桩提到共享 helper（12 份拷贝收成一份）。
import { FakeIpc } from './helpers/fake-ipc'
import { stubElectron } from './helpers/electron-mock'
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
// P28 (plan 2026-09-21): 窗口缩放档也在这层 stub——导出前必须钉回 1.0、结束后恢复。
const printToPdf = vi.hoisted(() => vi.fn(async () => Buffer.from('%PDF-1.7 fake-handout')))
const setZoomFactor = vi.hoisted(() => vi.fn())
const saveDialog = vi.hoisted(() => ({ canceled: false, filePath: '' }))
const showItemInFolder = vi.hoisted(() => vi.fn())

// 批8 (H25): electron 桩共享；showSaveDialog/showItemInFolder/窗口缩放档是本文件的
// 取证对象，在共享桩上就地覆写（不另抄整块）。
vi.mock('electron', () => {
  const electron = stubElectron()
  electron.dialog.showSaveDialog = vi.fn(async () => saveDialog)
  electron.shell.showItemInFolder = showItemInFolder
  // 当前窗口缩放 1.6（2560 宽窗的档）——printToPdfFile 应当先 setZoomFactor(1)
  // 再打印、finally 里 setZoomFactor(1.6) 恢复。
  electron.BrowserWindow.getFocusedWindow = () => ({ webContents: { printToPDF: printToPdf, getZoomFactor: () => 1.6, setZoomFactor } })
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
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-pdf-ipc-'))
  ipc = new FakeIpc()
  saveDialog.canceled = false
  saveDialog.filePath = ''
  printToPdf.mockClear()
  setZoomFactor.mockClear()
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

  it('P28: 窗口缩放≠1 时导出前钉回 1.0、结束后恢复原档（否则 A4 版式被整体缩放）', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const target = join(ctx.exportsDir(), 'handout.pdf')
    saveDialog.filePath = target
    const dialog = (await ipc.invoke('notes:exportPdfDialog', 'l1')) as { ok: boolean; value?: { token?: string } }
    const res = (await ipc.invoke('notes:exportPdfWrite', dialog.value?.token)) as { ok: boolean }
    expect(res.ok).toBe(true)
    // 打印发生在 zoom=1.0：setZoomFactor(1) 必须在 printToPDF 之前调用。
    expect(setZoomFactor).toHaveBeenCalledWith(1)
    const zoomCallOrder = setZoomFactor.mock.invocationCallOrder[0]!
    expect(zoomCallOrder).toBeLessThan(printToPdf.mock.invocationCallOrder[0]!)
    // 结束后恢复用户当前的窗口缩放档（1.6，本夹具的 stub 值）。
    expect(setZoomFactor).toHaveBeenLastCalledWith(1.6)
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
