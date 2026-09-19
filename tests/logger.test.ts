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

  it('covers the token after a Bearer scheme, not just the word (review 2026-09-05)', () => {
    const out = redact('provider said: authorization: Bearer sk-live-abc123')
    expect(out).not.toContain('sk-live-abc123')
    expect(out).toContain('[REDACTED]')
  })

  it('covers every cookie pair after the header name, not just the first', () => {
    const out = redact('harvest Cookie: JSESSIONID=aaa; CASTGT=bbb; route=ccc done')
    expect(out).not.toContain('aaa')
    expect(out).not.toContain('bbb')
    expect(out).not.toContain('ccc')
  })

  it('strips bilibili SESSDATA and bili_jct values (plan 2026-09-06 M3)', () => {
    const out = redact('bili poll SESSDATA=abc123; bili_jct=tok456 saved')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('tok456')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts the jwt-token credential header/param', () => {
    const out = redact('sent jwt-token=eyJhbGciO.secret to platform')
    expect(out).not.toContain('eyJhbGciO.secret')
    expect(out).toContain('jwt-token=[REDACTED]')
  })

  it('声明批7: 补上 DedeUserID——它和另两个 B 站 cookie 一样是账号标识', () => {
    // SESSDATA / bili_jct 早在名单里，DedeUserID 是当初漏掉的那个。
    const out = redact('bili cookies DedeUserID=12345678; SESSDATA=abc123 done')
    expect(out).not.toContain('12345678')
    expect(out).not.toContain('abc123')
  })

  it('健康巡查 2026-09-12: access/refresh token 与 password 入名单（纵深——当前无日志携带，未来不得先漏）', () => {
    // The school platform keeps a refresh token in localStorage and OAuth
    // flows hand out access tokens; any future response-body logging must
    // hit this net before the values reach disk.
    const out = redact(
      'oauth callback access_token=at-abc123 refresh_token=rt-xyz789 and password=hunter2 done'
    )
    expect(out).not.toContain('at-abc123')
    expect(out).not.toContain('rt-xyz789')
    expect(out).not.toContain('hunter2')
    expect(out).toContain('[REDACTED]')
  })

  it('批2: 常见 key 的裸形态入名单（sk-/AKIA/gsk_——name=value 规则罩不住配置转储）', () => {
    const out = redact('dump sk-AbCdEf123456 and AKIAABCDEFGHIJKLMNOP and gsk_abcdef123456 done')
    expect(out).not.toContain('sk-AbCdEf123456')
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP')
    expect(out).not.toContain('gsk_abcdef123456')
    expect(out).toContain('[REDACTED]')
  })

  it('批2: B 站设备 cookie 名入名单（buvid3|b_nut|x-bili-ticket）', () => {
    // SESSDATA/bili_jct/DedeUserID 之外，B 站登录态还发这三样设备标识。
    const out = redact('bili cookies buvid3=abc123def456; b_nut=nut789xyz; x-bili-ticket=tok012abc done')
    expect(out).not.toContain('abc123def456')
    expect(out).not.toContain('nut789xyz')
    expect(out).not.toContain('tok012abc')
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
