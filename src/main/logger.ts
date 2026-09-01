/**
 * File logger (U5): append-only, one file per day, rotated to keep the
 * newest MAX_LOG_FILES. Never logs cookies/keys/URLs with auth params —
 * everything passes through redact() before hitting disk. Logging must
 * never crash the app: every file operation is best-effort.
 */
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

export const MAX_LOG_FILES = 7
const MAX_LINE_CHARS = 4000

export type LogLevel = 'info' | 'warn' | 'error'

export class Logger {
  constructor(private readonly dir: string) {}

  log(level: LogLevel, message: string): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      const file = join(this.dir, `app-${new Date().toISOString().slice(0, 10)}.log`)
      const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${redact(message).slice(0, MAX_LINE_CHARS)}\n`
      appendFileSync(file, line)
      this.rotate()
    } catch {
      // Logging must never crash the app.
    }
  }

  info(message: string): void {
    this.log('info', message)
  }

  warn(message: string): void {
    this.log('warn', message)
  }

  error(message: string): void {
    this.log('error', message)
  }

  private rotate(): void {
    const files = readdirSync(this.dir)
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
    while (files.length > MAX_LOG_FILES) {
      const oldest = files.shift()
      if (oldest != null) {
        try {
          unlinkSync(join(this.dir, oldest))
        } catch {
          // Best effort.
        }
      }
    }
  }
}

/**
 * Redact credential-bearing substrings before they reach disk:
 * cookies/tokens/keys are replaced, URLs are reduced to origin+path.
 */
export function redact(message: string): string {
  return message
    .replace(/((?:cookie|authorization|api[_-]?key|castgt|tgt|auth_key)\s*[=:]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s"']+/gi, (url) => {
      try {
        const parsed = new URL(url)
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}…`
      } catch {
        return '[URL]'
      }
    })
}
