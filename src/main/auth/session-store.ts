import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import {
  type Cryptor,
  type SessionRecord,
  encryptSession,
  decryptSession
} from './session-crypto'

/**
 * Session persistence layout:
 * `<userData>/school-session/session.bin` — DPAPI-encrypted cookie blob.
 * The containing file never holds plaintext cookies.
 */
const SESSION_FILE = 'session.bin'

export function sessionDir(userDataDir: string): string {
  return join(userDataDir, 'school-session')
}

export function sessionFile(userDataDir: string): string {
  return join(sessionDir(userDataDir), SESSION_FILE)
}

export function saveSession(userDataDir: string, rec: SessionRecord, cryptor: Cryptor): void {
  mkdirSync(sessionDir(userDataDir), { recursive: true })
  writeFileSync(sessionFile(userDataDir), encryptSession(rec, cryptor))
}

export function loadSession(userDataDir: string, cryptor: Cryptor): SessionRecord | null {
  const file = sessionFile(userDataDir)
  if (!existsSync(file)) return null
  return decryptSession(readFileSync(file), cryptor)
}

export function clearSession(userDataDir: string): void {
  const file = sessionFile(userDataDir)
  if (existsSync(file)) {
    rmSync(file)
  }
}
