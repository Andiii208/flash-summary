import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { type Cryptor, type SessionRecord, encryptSession, decryptSession } from './session-crypto'

/**
 * Bilibili session persistence — same red-line contract as the school
 * session (plan 2026-09-06 M3): `bilibili-session/session.bin` under
 * userData, DPAPI-encrypted, plaintext cookies never on disk. The separate
 * directory keeps the two sources' credentials independent (deleting one
 * must not touch the other).
 */
const SESSION_FILE = 'session.bin'

export function bilibiliSessionDir(userDataDir: string): string {
  return join(userDataDir, 'bilibili-session')
}

export function bilibiliSessionFile(userDataDir: string): string {
  return join(bilibiliSessionDir(userDataDir), SESSION_FILE)
}

export function saveBilibiliSession(userDataDir: string, rec: SessionRecord, cryptor: Cryptor): void {
  mkdirSync(bilibiliSessionDir(userDataDir), { recursive: true })
  writeFileSync(bilibiliSessionFile(userDataDir), encryptSession(rec, cryptor))
}

export function loadBilibiliSession(userDataDir: string, cryptor: Cryptor): SessionRecord | null {
  const file = bilibiliSessionFile(userDataDir)
  if (!existsSync(file)) return null
  return decryptSession(readFileSync(file), cryptor)
}

export function clearBilibiliSession(userDataDir: string): void {
  const file = bilibiliSessionFile(userDataDir)
  if (existsSync(file)) {
    rmSync(file)
  }
}
