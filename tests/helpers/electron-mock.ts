/**
 * 批8 (audit 2026-09-28, H25): 共享的 electron 桩。
 *
 * tests/ 下 14 份测试各自手写 `vi.mock('electron', () => ({ ... }))`（约 350-400 行
 * 拷贝），字段漂移过好几次（有的忘了 `app.getVersion`、有的忘了 `openExternal`）。
 * 这里给出**生成 mock 对象的函数**：vi.mock 工厂因 hoisting 必须逐文件调用，所以
 * 导出的不是 mock 本身，而是"每次调用返回一份新 vi.fn()"的构造函数。
 *
 * 用法：
 *   import { stubElectron } from './helpers/electron-mock'
 *   const electron = vi.hoisted(() => stubElectron())
 *   vi.mock('electron', () => electron)
 *
 * 需要定制字段（如 notes-pdf-ipc 的 printToPDF）的文件在拿到的对象上就地覆写，
 * 不必再抄整块。
 */
import { vi } from 'vitest'

/** 桩对象的形状——只声明测试真正会摸到的面。 */
export interface ElectronStub {
  ipcMain: undefined
  dialog: {
    showSaveDialog: ReturnType<typeof vi.fn>
    showOpenDialog: ReturnType<typeof vi.fn>
  }
  shell: {
    openPath: ReturnType<typeof vi.fn>
    openExternal: ReturnType<typeof vi.fn>
    showItemInFolder: ReturnType<typeof vi.fn>
  }
  BrowserWindow: {
    /** 默认无焦点窗（handler 走无父窗分支）；需要具体 webContents 的文件就地覆写。 */
    getFocusedWindow: () => unknown
  }
  app: {
    isPackaged: boolean
    getVersion: () => string
  }
  WebContents: undefined
}

/**
 * 生成一份默认 electron 桩。默认值刻意取「良性」形态：保存/打开对话框返回取消、
 * shell 操作返回成功、`getFocusedWindow()` 为 null（handler 走无父窗分支）。
 */
export function stubElectron(): ElectronStub {
  return {
    ipcMain: undefined,
    dialog: {
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] }))
    },
    shell: {
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => undefined),
      showItemInFolder: vi.fn()
    },
    BrowserWindow: { getFocusedWindow: (): unknown => null },
    app: { isPackaged: false, getVersion: () => '0.0.0-test' },
    WebContents: undefined
  }
}
