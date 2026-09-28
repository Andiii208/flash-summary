/**
 * HTTP(S) download to file with retry and Range resume (U4).
 * Network is unreliable in the field: transient failures retry with a small
 * backoff, and a partial file is kept between attempts so a server that
 * honors `Range: bytes=N-` lets the next attempt resume instead of starting
 * over. Only the target path and byte counts are logged upstream; never
 * URLs with auth_key query parameters.
 */
import { createWriteStream, existsSync, statSync, type WriteStream } from 'fs'
import { unlink } from 'fs/promises'

export const MAX_ATTEMPTS = 20

export interface DownloadStats {
  bytes: number
  attempts: number
}

/**
 * H26 (audit 2026-09-28): 背压——`write()` 返回 false 表示内核缓冲已满，
 * 继续无脑写只会让内存里的待写队列越堆越高（课堂直链是 GB 级）。等一次
 * 'drain' 再写下一块；取消时不再等待（立即 reject，attempt 的 finally 会
 * 收拾流），写出错同样 reject 并销毁流。drain 一定会在 write() 返回 false
 * 之后的某个 tick 触发，而本函数在**同步**紧接着挂监听，不会错过。
 */
function waitForDrain(writer: WriteStream, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const detach = (): void => {
      writer.removeListener('drain', onDrain)
      writer.removeListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onDrain = (): void => {
      detach()
      resolve()
    }
    const onError = (err: Error): void => {
      detach()
      // 流已坏：销毁它释放文件句柄，finally 不能再 end/close。
      writer.destroy()
      reject(err)
    }
    const onAbort = (): void => {
      detach()
      writer.destroy()
      reject(new Error('任务已取消'))
    }
    writer.once('drain', onDrain)
    writer.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function attempt(url: string, target: string, signalTimeoutMs: number, signal?: AbortSignal): Promise<number> {
  const existing = existsSync(target) ? statSync(target).size : 0
  const headers: Record<string, string> | undefined = existing > 0 ? { Range: `bytes=${existing}-` } : undefined
  // Combine the per-attempt timeout with the caller's cancellation signal
  // (task cancel must interrupt an in-flight download immediately).
  const combined = signal != null ? AbortSignal.any([AbortSignal.timeout(signalTimeoutMs), signal]) : AbortSignal.timeout(signalTimeoutMs)
  const res = await fetch(url, { signal: combined, headers })
  // 416 on a Range request means offset >= size: the file is already
  // complete (field: a resume attempt landing exactly on the end used to
  // delete the finished file after burning all retries — review B4).
  if (res.status === 416 && existing > 0) return existing
  if (!res.ok || res.body == null) throw new Error(`download HTTP ${res.status}`)

  const append = res.status === 206
  if (!append && existing > 0) {
    // Server ignored the Range header — restart from an empty file.
    await unlink(target).catch(() => undefined)
  }
  const writer = createWriteStream(target, { flags: append ? 'a' : 'w' })
  const reader = res.body.getReader()
  let bytes = append ? existing : 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const flushed = writer.write(Buffer.from(value))
      bytes += value.byteLength
      // H26: 背压——write() 返回 false 时等 drain 再继续（取消/出错由
      // waitForDrain 抛错，且它已把流销毁，finally 不再动它）。
      if (!flushed) await waitForDrain(writer, signal)
    }
  } finally {
    // 取消/出错路径上流已被 destroy（句柄已释放）；正常路径照旧 end+close，
    // 把已写入的字节留给下一轮 Range 续传。
    if (!writer.destroyed) {
      writer.end()
      await new Promise<void>((resolve) => writer.close(() => resolve()))
    }
  }
  return bytes
}

export async function downloadToFile(url: string, target: string, attempts = MAX_ATTEMPTS, signal?: AbortSignal): Promise<DownloadStats> {
  let lastError: Error | null = null
  for (let i = 1; i <= attempts; i++) {
    if (signal?.aborted) throw new Error('任务已取消')
    try {
      const bytes = await attempt(url, target, 10 * 60 * 1000, signal)
      return { bytes, attempts: i }
    } catch (err) {
      if (signal?.aborted) throw new Error('任务已取消')
      lastError = err as Error
      // Keep the partial file for a Range resume on the next attempt.
      if (i < attempts) {
        const backoff = Math.min(1000 * 2 ** Math.min(i - 1, 6), 30_000)
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }
  await unlink(target).catch(() => undefined)
  throw new Error(`download failed after ${attempts} attempts: ${lastError?.message ?? 'unknown'}`)
}
