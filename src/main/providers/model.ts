/**
 * Provider configuration model (spec §4).
 *
 * Multiple providers; capabilities bound independently:
 * - asr:        provider + model (required for transcription)
 * - multimodal: provider + model (default note generation path)
 * - text:       provider + model (optional fallback)
 */
export interface ProviderConfig {
  id: string
  name: string
  baseUrl: string
  /** Stored DPAPI-encrypted at rest; never logged. */
  apiKey: string
  hasKey: boolean
  createdAt: string
}

export type Capability = 'asr' | 'multimodal' | 'text'

export interface CapabilityBinding {
  capability: Capability
  providerId: string
  model: string
}

export interface ProviderSettings {
  providers: ProviderConfig[]
  bindings: CapabilityBinding[]
}

export const EMPTY_SETTINGS: ProviderSettings = { providers: [], bindings: [] }

/** Resolve the provider+model pair for a capability, or null when unbound. */
export function resolveCapability(
  settings: ProviderSettings,
  capability: Capability
): { provider: ProviderConfig; model: string } | null {
  const binding = settings.bindings.find((b) => b.capability === capability)
  if (binding == null) return null
  const provider = settings.providers.find((p) => p.id === binding.providerId)
  if (provider == null || provider.apiKey === '') return null
  return { provider, model: binding.model }
}

/** Validate a provider config before persisting. */
export function validateProvider(input: Omit<ProviderConfig, 'hasKey' | 'createdAt'> & { createdAt?: string }): ProviderConfig {
  const id = input.id.trim()
  const name = input.name.trim()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  if (id === '') throw new Error('provider id is required')
  if (name === '') throw new Error('provider name is required')
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('provider base URL must start with http(s)://')
  return {
    id,
    name,
    baseUrl,
    apiKey: input.apiKey,
    hasKey: input.apiKey !== '',
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}
