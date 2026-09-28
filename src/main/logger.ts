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

  /**
   * 最近一次 rotate 时写入的日期键（`yyyy-mm-dd`）——跨天必须重新扫描。
   */
  private rotateDay: string | null = null
  /** 同一天内最近一次 rotate 的时刻（epoch ms）——每分钟最多扫一次目录。 */
  private rotateAt = 0

  log(level: LogLevel, message: string): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      const now = new Date()
      const file = join(this.dir, `app-${now.toISOString().slice(0, 10)}.log`)
      const line = `${now.toISOString()} [${level.toUpperCase()}] ${redact(message).slice(0, MAX_LINE_CHARS)}\n`
      appendFileSync(file, line)
      this.rotateIfDue(now)
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

  /**
   * H27 (audit 2026-09-28): 旧实现每条日志都跑一次 rotate（readdirSync +
   * 排序，关键路径上是 O(行数) 次目录扫描——下载/转写阶段每秒数行时主进程
   * 被反复扫目录）。语义不变（跨天换文件、超 MAX_LOG_FILES 清理照旧），
   * 只把扫描收敛成：换日必做，同一天内每分钟最多一次。
   */
  private rotateIfDue(now: Date): void {
    const day = now.toISOString().slice(0, 10)
    if (this.rotateDay !== day) {
      this.rotateDay = day
      this.rotateAt = now.getTime()
      this.rotate()
      return
    }
    if (now.getTime() - this.rotateAt >= 60_000) {
      this.rotateAt = now.getTime()
      this.rotate()
    }
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
 * 绝对路径 → `…\末段`：把用户的目录链折掉，只留文件名。
 *
 * 批3 (plan 2026-09-20, P23 评审补口)：vault 不可写这类错误的原文长这样——
 * `EISDIR: illegal operation on a directory, open 'C:\Users\<用户名>\…\vault\第2节课.md'`。
 * 方案 3.2 的落点写着「vault 路径脱敏走既有 redact」，而 redact 此前只罩凭据与 URL，
 * **没有任何文件系统路径规则**（那句声明当时不成立）。现在补上这条规则，日志侧由
 * `redact()` 统一执行；**toast 不经过 redact**，所以失败原因在产生时就调本函数折一次
 * （`notes/obsidian-export.ts`）——同一把尺子，两个出口都不带完整目录链。
 *
 * 只折 Windows 盘符与 UNC 两种绝对形态（本产品 Windows only）：引号包裹的（Node 的
 * errno 消息）允许含空格，未加引号的遇到空白即止（避免把后面的散文当路径吃掉）。
 */
export function foldAbsolutePaths(message: string): string {
  return message
    .replace(/(["'])((?:[A-Za-z]:[\\/]|\\\\(?:\?[\\/])?)[^"']*)\1/g, (_match, quote: string, path: string) => `${quote}${foldPathTail(path)}${quote}`)
    // 盘符前必须是词边界：`https://…` 里的 `s:/` 不是盘符（否则 URL 规则刚折好的
    // origin+path 会被这条规则再吃一次，实测会变成 `http…\v.mp4…`）。
    .replace(/(?<![A-Za-z0-9_])(?:[A-Za-z]:[\\/]|\\\\(?:\?[\\/])?)[^\s"'<>|?*]+/g, (path) => foldPathTail(path))
}

/** 取路径的最后一段（`C:\a\b.md` → `…\b.md`）。 */
function foldPathTail(path: string): string {
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== '')
  const tail = segments[segments.length - 1] ?? ''
  return tail === '' ? '…' : `…\\${tail}`
}

/**
 * Redact credential-bearing substrings before they reach disk:
 * cookies/tokens/keys are replaced, URLs are reduced to origin+path,
 * absolute paths are folded to their file name.
 */
export function redact(message: string): string {
  return foldAbsolutePaths(redactCredentials(message))
}

/**
 * 凭据与 URL 规则（**不含**绝对路径折叠）。
 *
 * 只有「用户会复制出去给开发者定位问题」的诊断文本用这一支（`ipc.ts` 的
 * `feedback:diagnostics`）：那里的日志目录路径正是开发者唯一能用来找日志的线索
 * （`tests/ipc-feedback.test.ts` 有钉住断言），而路径不是凭据。日志侧的默认出口是
 * `redact()`——它额外折掉目录链（批3 P23：vault 不可写的 errno 原文会带用户完整目录链）。
 */
export function redactCredentials(message: string): string {
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
