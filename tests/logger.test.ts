import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Logger, redact, MAX_LOG_FILES } from '../src/main/logger'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-logger-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('redact (U5 安全红线)', () => {
  it('strips cookies, tokens and api keys before they reach disk', () => {
    const out = redact('request failed: Cookie: JSESSIONID=abc123; CASTGT=tok api_key=sk-xyz')
    expect(out).not.toContain('JSESSIONID')
    expect(out).not.toContain('tok')
    expect(out).not.toContain('sk-xyz')
    expect(out).toContain('[REDACTED]')
  })

  it('reduces URLs to origin+path (auth_key query values never logged)', () => {
    const out = redact('download https://media.example.com/v.mp4?auth_key=secret123 done')
    expect(out).not.toContain('secret123')
    expect(out).toContain('https://media.example.com/v.mp4…')
  })
})

describe('Logger (U5)', () => {
  it('writes timestamped level lines to a daily file', () => {
    const logger = new Logger(dir)
    logger.info('app started')
    logger.error('task t1 failed at stage transcribing: boom')
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    const content = readFileSync(join(dir, files[0]!), 'utf8')
    expect(content).toContain('[INFO] app started')
    expect(content).toContain('[ERROR] task t1 failed')
  })

  it('rotates daily files, keeping only the newest ones', () => {
    const logger = new Logger(dir)
    // Fabricate MAX_LOG_FILES + 2 older daily files.
    for (let i = 1; i <= MAX_LOG_FILES + 2; i++) {
      const name = `app-2026-08-${String(10 + i).padStart(2, '0')}.log`
      writeFileSync(join(dir, name), 'old\n')
      utimesSync(join(dir, name), Date.now() / 1000, Date.now() / 1000)
    }
    logger.info('today')
    const files = readdirSync(dir).sort()
    expect(files).toHaveLength(MAX_LOG_FILES)
    expect(files[files.length - 1]).toMatch(/app-\d{4}-\d{2}-\d{2}\.log$/)
  })
})
