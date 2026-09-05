/**
 * Serial task executor (U4): at most one task runs at a time; concurrent
 * run requests queue up and execute in FIFO order. `current()` exposes the
 * running task id; `members()` exposes running + queued ids so the guards
 * (close-window confirm, cancel, cleanup) cover the whole queue, not just
 * the running task (review 2026-09-05 D1/D5).
 */
export class SerialTaskQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private runningId: string | null = null
  private readonly queuedIds = new Set<string>()

  enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    // Review D1: the queue itself rejects a duplicate id — the renderer's
    // guards are UX only, the main process is the invariant's home.
    if (this.runningId === id || this.queuedIds.has(id)) {
      return Promise.reject(new Error('该任务已在队列中'))
    }
    this.queuedIds.add(id)
    const next = this.tail.then(
      () => this.run(id, fn),
      () => this.run(id, fn)
    )
    this.tail = next.catch(() => undefined)
    return next
  }

  private async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    this.queuedIds.delete(id)
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

  /** Running + queued task ids, running first. */
  members(): string[] {
    return this.runningId != null ? [this.runningId, ...this.queuedIds] : [...this.queuedIds]
  }
}
