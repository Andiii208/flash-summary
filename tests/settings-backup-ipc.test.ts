import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'
import { createContext } from '../src/main/app-context'
import { registerIpc, setAppRendererOrigin } from '../src/main/ipc'
import type { Cryptor } from '../src/main/auth/session-crypto'
import type { Db } from '../src/main/db/open'
import type { AppContext } from '../src/main/app-context'

// 批6 (plan 2026-09-19, D4 推荐侧): settings:exportLibraryBackup — the save
// dialog is mocked at the electron layer (same seam as notes-pdf-ipc).
const saveDialog = vi.hoisted(() => ({ canceled: false, filePath: '' }))
const showSaveDialog = vi.hoisted(() => vi.fn(async (_options: unknown) => saveDialog))

vi.mock('electron', () => ({
  ipcMain: undefined,
  dialog: { showSaveDialog, showOpenDialog: vi.fn(async () => ({ canceled: true })) },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
  app: { isPackaged: false, getVersion: () => '0.0.0-test' },
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

let db: Db
let dir: string
let ipc: FakeIpc

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-backup-ipc-'))
  ipc = new FakeIpc()
  saveDialog.canceled = false
  saveDialog.filePath = ''
  showSaveDialog.mockClear()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function makeCtx(): AppContext {
  const ctx = createContext({ libraryRoot: dir, userDataDir: join(dir, 'userdata'), cryptor: stubCryptor })
  db = ctx.db
  db.prepare("INSERT INTO courses (id, name, teacher, fetched_at) VALUES ('c1', 'Python语言设计 4', '高旺', '2026-09-19T00:00:00Z')").run()
  return ctx
}

describe('settings:exportLibraryBackup (批6, D4)', () => {
  it('writes a WAL-consistent backup that better-sqlite3 can open (integrity_check ok, rows intact)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    const outDir = join(dir, 'out')
    mkdirSync(outDir, { recursive: true })
    const target = join(outDir, 'seu-summary-backup.db')
    saveDialog.filePath = target

    const res = (await ipc.invoke('settings:exportLibraryBackup')) as { ok: boolean; value?: { canceled: boolean; path?: string } }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ canceled: false, path: target })
    expect(existsSync(target)).toBe(true)
    // tmp 中间产物必须已 rename 落位，不留 .tmp 残影（修复轮 I2）。
    expect(existsSync(`${target}.tmp`)).toBe(false)

    // The backup must be a real, openable database — not a half-written file.
    const opened = new Database(target, { readonly: true })
    try {
      expect(opened.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
      expect((opened.prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n).toBe(1)
      expect((opened.prepare('SELECT name FROM courses').get() as { name: string }).name).toBe('Python语言设计 4')
    } finally {
      opened.close()
    }
  })

  it('defaults the save dialog into the exports dir with a .db filter', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    saveDialog.filePath = join(ctx.exportsDir(), 'seu-summary-backup.db')
    mkdirSync(ctx.exportsDir(), { recursive: true })

    const res = (await ipc.invoke('settings:exportLibraryBackup')) as { ok: boolean }
    expect(res.ok).toBe(true)
    const options = showSaveDialog.mock.calls[0]![0] as unknown as { title: string; defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }
    expect(options.title).toContain('备份')
    expect(options.defaultPath.startsWith(ctx.exportsDir())).toBe(true)
    expect(options.defaultPath.endsWith('.db')).toBe(true)
    expect(options.filters.some((f) => f.extensions.includes('db'))).toBe(true)
  })

  it('cancel (dialog closed) resolves canceled and leaves no file behind', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    saveDialog.canceled = true
    saveDialog.filePath = ''

    const res = (await ipc.invoke('settings:exportLibraryBackup')) as { ok: boolean; value?: { canceled: boolean } }
    expect(res.ok).toBe(true)
    expect(res.value).toEqual({ canceled: true })
    expect(showSaveDialog).toHaveBeenCalledTimes(1)
  })

  // 修复轮 I2：契约有意变更。旧实现失败时无条件 rmSync(filePath)——会删掉
  // 用户预存在目标路径上自己的文件。新契约：备份落 `${filePath}.tmp`、成功
  // renameSync 落位、失败只清 .tmp——预写文件必须原样保留。
  it('a failed backup keeps a pre-existing target file intact (修复轮 I2: tmp/rename, 只清 .tmp)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    // Garbage parked at the .tmp slot: the backup fails there ("file is not a
    // database"), the user's own file at the target must survive byte-for-byte.
    const target = join(dir, 'mine.db')
    const targetTmp = `${target}.tmp`
    writeFileSync(target, 'my precious database')
    writeFileSync(targetTmp, 'not a database')
    saveDialog.filePath = target

    const res = (await ipc.invoke('settings:exportLibraryBackup')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('备份失败')
    // 用户预存文件原样保留；只有我们自己的 .tmp 半成品被清掉。
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('my precious database')
    expect(existsSync(targetTmp)).toBe(false)
  })

  it('refuses to back up onto the live library db itself (修复轮 I2)', async () => {
    const ctx = makeCtx()
    registerIpc(ctx, ipc as never)
    saveDialog.filePath = join(dir, 'app.db')

    const res = (await ipc.invoke('settings:exportLibraryBackup')) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('本身')
    // 活库未被触碰——打不开/被截断都会在这里现形。
    const opened = new Database(join(dir, 'app.db'), { readonly: true })
    try {
      expect((opened.prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n).toBe(1)
    } finally {
      opened.close()
    }
  })
})
