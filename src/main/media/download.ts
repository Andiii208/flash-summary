/**
 * HTTP(S) download to file with retry and Range resume (U4).
 * Network is unreliable in the field: transient failures retry with a small
 * backoff, and a partial file is kept between attempts so a server that
 * honors `Range: bytes=N-` lets the next attempt resume instead of starting
 * over. Only the target path and byte counts are logged upstream; never
 * URLs with auth_key query parameters.
 */
import { createWriteStream, existsSync, statSync } from 'fs'
import { unlink } from 'fs/promises'

export const MAX_ATTEMPTS = 20

export interface DownloadStats {
  bytes: number
  attempts: number
}

async function attempt(url: string, target: string, signalTimeoutMs: number): Promise<number> {
  const existing = existsSync(target) ? statSync(target).size : 0
  const headers: Record<string, string> | undefined = existing > 0 ? { Range: `bytes=${existing}-` } : undefined
  const res = await fetch(url, { signal: AbortSignal.timeout(signalTimeoutMs), headers })
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
      writer.write(Buffer.from(value))
      bytes += value.byteLength
    }
  } finally {
    writer.end()
    await new Promise<void>((resolve) => writer.close(() => resolve()))
  }
  return bytes
}

export async function downloadToFile(url: string, target: string, attempts = MAX_ATTEMPTS): Promise<DownloadStats> {
  let lastError: Error | null = null
  for (let i = 1; i <= attempts; i++) {
    try {
      const bytes = await attempt(url, target, 10 * 60 * 1000)
      return { bytes, attempts: i }
    } catch (err) {
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
