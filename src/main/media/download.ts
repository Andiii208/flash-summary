/**
 * HTTP(S) download to file with retry — network is unreliable in the field,
 * so every download retries up to MAX_ATTEMPTS with a small backoff.
 * Only the target path and byte counts are logged upstream; never URLs with
 * auth_key query parameters.
 */
import { createWriteStream } from 'fs'
import { unlink } from 'fs/promises'

export const MAX_ATTEMPTS = 20

export interface DownloadStats {
  bytes: number
  attempts: number
}

async function attempt(url: string, target: string, signalTimeoutMs: number): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(signalTimeoutMs) })
  if (!res.ok || res.body == null) throw new Error(`download HTTP ${res.status}`)

  let bytes = 0
  const writer = createWriteStream(target)
  const reader = res.body.getReader()
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
      await unlink(target).catch(() => undefined)
      if (i < attempts) {
        const backoff = Math.min(1000 * 2 ** Math.min(i - 1, 6), 30_000)
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }
  throw new Error(`download failed after ${attempts} attempts: ${lastError?.message ?? 'unknown'}`)
}
