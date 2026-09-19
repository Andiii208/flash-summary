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
    // Bearer scheme first: the generic name=value rule would only eat the
    // word "Bearer" and leave the token behind (review 2026-09-05).
    .replace(/(authorization\s*:\s*bearer\s+)\S+/gi, '$1[REDACTED]')
    // Cookie header: every pair after the name is credential material, so
    // redact to end of line instead of stopping at the first ';'.
    .replace(/(cookie\s*[:=]\s*).*/gi, '$1[REDACTED]')
    // Generic name=value credentials; the value runs to whitespace/;/quote.
    // Health audit 2026-09-12: access/refresh tokens live in the school
    // platform's localStorage and OAuth flows — no current log line carries
    // them, but any future response-body logging must not leak them first.
    // 批2 (audit 2026-09-19): B 站设备 cookie buvid3/b_nut/x-bili-ticket 同属
    // 账号标识，并入同一名单。
    .replace(/((?:api[_-]?key|castgt|tgt|auth_key|jwt[-_]?token|sessdata|bili_jct|dedeuserid|access[_-]?token|refresh[_-]?token|password|buvid3|b_nut|x-bili-ticket)\s*[=:]\s*)(?:"[^"]*"|[^\s;"]*)/gi, '$1[REDACTED]')
    // 批2 (audit 2026-09-19): 常见 key 的裸形态——name=value 规则要求等号在旁，
    // 而配置转储/异常栈里 key 常单独出现。三段前缀：OpenAI 形态 sk-、AWS
    // access key id AKIA、Groq 形态 gsk_。
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]')
    .replace(/\bgsk_[A-Za-z0-9]{12,}/g, '[REDACTED]')
    .replace(/https?:\/\/[^\s"']+/gi, (url) => {
      try {
        const parsed = new URL(url)
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}…`
      } catch {
        return '[URL]'
      }
    })
}
