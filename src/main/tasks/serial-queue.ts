/**
 * Serial task executor (U4): at most one task runs at a time; concurrent
 * run requests queue up and execute in FIFO order. `current()` exposes the
 * running task id so cache cleanup can skip its directory.
 */
export class SerialTaskQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private runningId: string | null = null

  enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(
      () => this.run(id, fn),
      () => this.run(id, fn)
    )
    this.tail = next.catch(() => undefined)
    return next
  }

  private async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    this.runningId = id
    try {
      return await fn()
    } finally {
      this.runningId = null
    }
  }

  /** Task currently executing (or null when idle). */
  current(): string | null {
    return this.runningId
  }
}
