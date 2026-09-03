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

/**
 * Expiry time (epoch ms) of the stored platform JWT, parsed locally from its
 * exp claim — no network involved. null when the record carries no JWT, the
 * token is malformed, or it has no exp claim (then freshness is unknown and
 * the session keeps counting as logged_in).
 */
export function jwtExpiresAt(jwt: string | undefined): number | null {
  if (jwt == null || jwt === '') return null
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: unknown }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
    return payload.exp * 1000
  } catch {
    return null
  }
}
