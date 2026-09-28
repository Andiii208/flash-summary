/**
 * 批8 (audit 2026-09-28, H25): 共享的 FakeIpc。
 *
 * tests/ 下 12 份 IPC 测试各自手抄同一份 in-memory ipcMain 替身（handle/invoke +
 * 一个伪装成应用 UI 的 senderFrame）。拷贝之间已经开始漂移：有的漏了
 * `invokeFrom`（伪造调用方 URL 的用例只能另起一份），有的注释与实现脱节。
 * 这里收成一份——E1 校验口径（只认 `file:///app/index.html`）只有一处定义。
 *
 * `registerIpc(ctx, ipc as never)` 处的 `as never` 是给 electron.ipc.IpcMain
 * 让路的历史写法，保留原样（形状上 handle/invoke 已对齐）。
 */
/** ipcMain 替身：登记 handler、以应用 UI 身份调用。 */
export class FakeIpc {
  readonly handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  handle(channel: string, fn: (e: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, fn)
  }
  /** 以应用 renderer 的 URL 调用（E1 (review): handlers verify the sender frame）。 */
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    return fn({ senderFrame: { url: 'file:///app/index.html' } }, ...args)
  }

  /** 以**其它** origin 调用——伪造调用方的用例用它（E1 拒否路径）。 */
  async invokeFrom(url: string, channel: string, ...args: unknown[]): Promise<unknown> {
    const fn = this.handlers.get(channel)
    if (fn == null) throw new Error(`no handler for ${channel}`)
    return fn({ senderFrame: { url } }, ...args)
  }
}
