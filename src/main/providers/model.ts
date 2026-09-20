/**
 * Provider configuration model (spec §4).
 *
 * Multiple providers; exactly two capabilities bound independently:
 * - asr:        provider + model (required for transcription)
 * - multimodal: provider + model (default note generation path; Q&A too)
 *
 * 2026-09-21 (P25, plan 2026-09-20-ux-issues-remediation.md 补批): the third
 * capability `text` is gone — it never had a real consumer of its own (the
 * follow-up Q&A path was its only user, and a multimodal model answers text
 * questions anyway), and the user asked for two options, not three. Q&A now
 * resolves through the `multimodal` binding (see `qaCapability`).
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

export type Capability = 'asr' | 'multimodal'

export interface CapabilityBinding {
  capability: Capability
  providerId: string
  model: string
}

export interface ProviderSettings {
  providers: ProviderConfig[]
  bindings: CapabilityBinding[]
}

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
  // E5 (review): an http:// base URL ships the API key as a plaintext
  // Bearer header — https everywhere except explicit local debugging.
  if (baseUrl.startsWith('http://')) {
    const host = new URL(baseUrl).hostname
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
    if (!isLocal) throw new Error('Provider 地址必须使用 https://（本机调试可用 localhost/127.0.0.1）')
  }
  return {
    id,
    name,
    baseUrl,
    apiKey: input.apiKey,
    hasKey: input.apiKey !== '',
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}
