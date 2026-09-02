/**
 * Provider settings persistence.
 *
 * Schema: providers table (Phase 1) holds provider rows; the API key column
 * stores a DPAPI-sealed base64 blob (`enc:v1:` prefix). Keys are encrypted
 * with the same Cryptor used for the school session (spec §9).
 */
import type { Db } from '../db/open'
import type { Cryptor } from '../auth/session-crypto'
import type { ProviderConfig, CapabilityBinding, ProviderSettings, Capability } from './model'

const ENC_PREFIX = 'enc:v1:'

function sealKey(plain: string, cryptor: Cryptor): string {
  if (plain === '') return ''
  return ENC_PREFIX + cryptor.encryptString(plain).toString('base64')
}

function unsealKey(stored: string, cryptor: Cryptor): string {
  if (stored === '') return ''
  if (!stored.startsWith(ENC_PREFIX)) {
    throw new Error('provider api key is not encrypted — refusing to read')
  }
  return cryptor.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
}

interface ProviderRow {
  id: string
  name: string
  base_url: string
  api_key: string
  created_at: string
}

interface BindingRow {
  capability: string
  provider_id: string
  model: string
}

export function loadProviderSettings(db: Db, cryptor: Cryptor): ProviderSettings {
  const providers = (db.prepare('SELECT id, name, base_url, api_key, created_at FROM providers').all() as ProviderRow[]).map(
    (row): ProviderConfig => ({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: unsealKey(row.api_key, cryptor),
      hasKey: row.api_key !== '',
      createdAt: row.created_at
    })
  )
  const bindings = (db.prepare('SELECT capability, provider_id, model FROM capability_bindings').all() as BindingRow[]).map(
    (row): CapabilityBinding => ({
      capability: row.capability as Capability,
      providerId: row.provider_id,
      model: row.model
    })
  )
  return { providers, bindings }
}

export function upsertProvider(db: Db, cryptor: Cryptor, provider: ProviderConfig): void {
  db.prepare(
    `INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, base_url = excluded.base_url, api_key = excluded.api_key`
  ).run(provider.id, provider.name, provider.baseUrl, sealKey(provider.apiKey, cryptor), provider.createdAt)
}

export function deleteProvider(db: Db, providerId: string): void {
  db.prepare('DELETE FROM providers WHERE id = ?').run(providerId)
  db.prepare('DELETE FROM capability_bindings WHERE provider_id = ?').run(providerId)
}

export function setBinding(db: Db, binding: CapabilityBinding): void {
  db.prepare(
    `INSERT INTO capability_bindings (capability, provider_id, model) VALUES (?, ?, ?)
     ON CONFLICT(capability) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model`
  ).run(binding.capability, binding.providerId, binding.model)
}
