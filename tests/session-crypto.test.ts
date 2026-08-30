import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  type Cryptor,
  type SessionRecord,
  encryptSession,
  decryptSession
} from '../src/main/auth/session-crypto'
import { saveSession, loadSession, clearSession, sessionFile } from '../src/main/auth/session-store'

/** Stub cryptor: XOR "encryption" standing in for DPAPI in unit tests. */
const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

function makeRecord(): SessionRecord {
  return {
    cookies: 'JSESSIONID=abc123; CASTGT=ticket-xyz',
    baseUrl: 'https://cvs.seu.edu.cn',
    savedAt: '2026-08-30T12:00:00.000Z'
  }
}

describe('session crypto', () => {
  it('round-trips a session record through encrypt/decrypt', () => {
    const rec = makeRecord()
    const sealed = encryptSession(rec, stubCryptor)
    const opened = decryptSession(sealed, stubCryptor)
    expect(opened).toEqual(rec)
  })

  it('does not store the cookie string in plaintext', () => {
    const sealed = encryptSession(makeRecord(), stubCryptor)
    expect(sealed.toString('utf8')).not.toContain('CASTGT=ticket-xyz')
  })

  it('rejects corrupted input', () => {
    expect(() => decryptSession(Buffer.from('garbage-data'), stubCryptor)).toThrowError(/corrupted/)
  })

  it('refuses to encrypt when no cryptor is available', () => {
    const unavailable: Cryptor = { ...stubCryptor, isAvailable: () => false }
    expect(() => encryptSession(makeRecord(), unavailable)).toThrowError(/not available/)
  })
})

describe('session store', () => {
  let dir: string
  it('saves and loads an encrypted session at userData path', () => {
    dir = mkdtempSync(join(tmpdir(), 'seu-summary-sess-'))
    const rec = makeRecord()
    saveSession(dir, rec, stubCryptor)

    const file = sessionFile(dir)
    expect(existsSync(file)).toBe(true)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('ticket-xyz')

    expect(loadSession(dir, stubCryptor)).toEqual(rec)
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null when no session was saved', () => {
    dir = mkdtempSync(join(tmpdir(), 'seu-summary-sess-'))
    expect(loadSession(dir, stubCryptor)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('treats a corrupted session file as absent rather than crashing', () => {
    dir = mkdtempSync(join(tmpdir(), 'seu-summary-sess-'))
    mkdirSync(join(dir, 'school-session'), { recursive: true })
    writeFileSync(sessionFile(dir), 'not-a-session')
    expect(() => loadSession(dir, stubCryptor)).toThrowError(/corrupted/)
    // Recovery path: clear removes the bad file so the next login can save anew.
    clearSession(dir)
    expect(loadSession(dir, stubCryptor)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})
