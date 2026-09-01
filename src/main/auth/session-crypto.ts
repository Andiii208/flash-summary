/**
 * Crypt (DPAPI) storage for the school session.
 *
 * Uses Electron safeStorage, which is DPAPI-backed on Windows. The module is
 * shaped as pure functions over a small interface so unit tests can exercise
 * the serialization logic without Electron.
 */
export interface Cryptor {
  /** Returns true when the runtime can encrypt (safeStorage.isEncryptionAvailable). */
  isAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (buf: Buffer) => string
}

export interface SessionRecord {
  /** Platform cookie string (`k=v; k2=v2`), encrypted at rest. */
  cookies: string
  /** Base URL the session belongs to (e.g. https://cvs.seu.edu.cn). */
  baseUrl: string
  savedAt: string
  /** Platform JWT (sent as the `jwt-token` request header), encrypted at rest. */
  jwt?: string
}

const MAGIC = 'SEUSUM1'

function serialize(rec: SessionRecord): Buffer {
  const json = Buffer.from(JSON.stringify(rec), 'utf8')
  return Buffer.concat([Buffer.from(MAGIC, 'utf8'), json])
}

function deserialize(buf: Buffer): SessionRecord {
  const magic = buf.subarray(0, MAGIC.length).toString('utf8')
  if (magic !== MAGIC) throw new Error('session file is corrupted or not a session file')
  return JSON.parse(buf.subarray(MAGIC.length).toString('utf8')) as SessionRecord
}

/** Encrypt a session record to bytes. Throws when no cryptor is available. */
export function encryptSession(rec: SessionRecord, cryptor: Cryptor): Buffer {
  if (!cryptor.isAvailable()) throw new Error('DPAPI encryption is not available on this system')
  const sealed = cryptor.encryptString(rec.cookies)
  return serialize({ ...rec, cookies: sealed.toString('base64') })
}

/** Decrypt session bytes back to a record. */
export function decryptSession(buf: Buffer, cryptor: Cryptor): SessionRecord {
  const rec = deserialize(buf)
  const sealed = Buffer.from(rec.cookies, 'base64')
  return { ...rec, cookies: cryptor.decryptString(sealed) }
}
