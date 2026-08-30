import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { type Cryptor } from '../src/main/auth/session-crypto'
import { loadProviderSettings, upsertProvider, deleteProvider, setBinding } from '../src/main/providers/store'
import { validateProvider } from '../src/main/providers/model'

/** XOR stub cryptor standing in for DPAPI (same as session tests). */
const stubCryptor: Cryptor = {
  isAvailable: () => true,
  encryptString: (plain) => Buffer.from(plain.split('').map((ch) => ch.charCodeAt(0) ^ 0x5a)),
  decryptString: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8')
}

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-prov-'))
  db = openDatabase(join(dir, 'app.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('provider store (DPAPI-encrypted keys)', () => {
  it('round-trips a provider with an encrypted key at rest', () => {
    const provider = validateProvider({
      id: 'p1',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1/',
      apiKey: 'sk-super-secret'
    })
    upsertProvider(db, stubCryptor, provider)

    // Raw row must not contain the plaintext key.
    const raw = (db.prepare('SELECT api_key FROM providers WHERE id = ?').get('p1') as { api_key: string }).api_key
    expect(raw.startsWith('enc:v1:')).toBe(true)
    expect(raw).not.toContain('sk-super-secret')
    // The on-disk file must not contain the plaintext key either (WAL flush).
    db.pragma('wal_checkpoint(TRUNCATE)')
    const disk = readFileSync(join(dir, 'app.db'), 'utf8')
    expect(disk.includes('sk-super-secret')).toBe(false)

    // Load returns the decrypted key.
    const settings = loadProviderSettings(db, stubCryptor)
    expect(settings.providers).toHaveLength(1)
    expect(settings.providers[0].apiKey).toBe('sk-super-secret')
    expect(settings.providers[0].hasKey).toBe(true)
  })

  it('updates an existing provider (upsert)', () => {
    const p1 = validateProvider({ id: 'p1', name: 'A', baseUrl: 'https://a/v1', apiKey: 'k1' })
    upsertProvider(db, stubCryptor, p1)
    const p2 = validateProvider({ id: 'p1', name: 'A2', baseUrl: 'https://a2/v1', apiKey: 'k2' })
    upsertProvider(db, stubCryptor, p2)

    const settings = loadProviderSettings(db, stubCryptor)
    expect(settings.providers).toHaveLength(1)
    expect(settings.providers[0].name).toBe('A2')
    expect(settings.providers[0].apiKey).toBe('k2')
  })

  it('deletes a provider and cascades its bindings', () => {
    const p = validateProvider({ id: 'p1', name: 'A', baseUrl: 'https://a/v1', apiKey: 'k' })
    upsertProvider(db, stubCryptor, p)
    setBinding(db, { capability: 'asr', providerId: 'p1', model: 'whisper-1' })

    deleteProvider(db, 'p1')
    const settings = loadProviderSettings(db, stubCryptor)
    expect(settings.providers).toEqual([])
    expect(settings.bindings).toEqual([])
  })

  it('stores and updates capability bindings', () => {
    const p = validateProvider({ id: 'p1', name: 'A', baseUrl: 'https://a/v1', apiKey: 'k' })
    upsertProvider(db, stubCryptor, p)
    setBinding(db, { capability: 'asr', providerId: 'p1', model: 'whisper-1' })
    setBinding(db, { capability: 'asr', providerId: 'p1', model: 'whisper-large' })

    const settings = loadProviderSettings(db, stubCryptor)
    expect(settings.bindings).toEqual([{ capability: 'asr', providerId: 'p1', model: 'whisper-large' }])
  })

  it('refuses to read a plaintext (unencrypted) key from the database', () => {
    db.prepare(
      "INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('px', 'X', 'https://x/v1', 'sk-plaintext', '2026-08-30T00:00:00Z')"
    ).run()
    expect(() => loadProviderSettings(db, stubCryptor)).toThrowError(/not encrypted/)
  })
})
