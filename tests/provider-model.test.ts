import { describe, expect, it } from 'vitest'
import {
  resolveCapability,
  validateProvider,
  type ProviderSettings
} from '../src/main/providers/model'

const EMPTY_SETTINGS: ProviderSettings = { providers: [], bindings: [] }

function makeSettings(): ProviderSettings {
  return {
    providers: [
      { id: 'p1', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-1', hasKey: true, createdAt: '2026-08-30T00:00:00Z' },
      { id: 'p2', name: 'Local', baseUrl: 'http://localhost:8000/v1', apiKey: 'sk-2', hasKey: true, createdAt: '2026-08-30T00:00:00Z' }
    ],
    bindings: [
      { capability: 'asr', providerId: 'p1', model: 'whisper-1' },
      { capability: 'multimodal', providerId: 'p1', model: 'gpt-4o' },
      { capability: 'text', providerId: 'p2', model: 'qwen2.5' }
    ]
  }
}

describe('capability resolution', () => {
  it('resolves each capability independently', () => {
    const s = makeSettings()
    expect(resolveCapability(s, 'asr')).toEqual({ provider: s.providers[0], model: 'whisper-1' })
    expect(resolveCapability(s, 'multimodal')?.model).toBe('gpt-4o')
    expect(resolveCapability(s, 'text')?.model).toBe('qwen2.5')
  })

  it('returns null for unbound capabilities or keyless providers', () => {
    expect(resolveCapability(EMPTY_SETTINGS, 'asr')).toBeNull()
    const broken: ProviderSettings = {
      providers: [{ id: 'p2', name: 'Local', baseUrl: 'https://x/v1', apiKey: '', hasKey: false, createdAt: '2026-08-30T00:00:00Z' }],
      bindings: [{ capability: 'asr', providerId: 'p2', model: 'whisper' }]
    }
    expect(resolveCapability(broken, 'asr')).toBeNull()
  })
})

describe('provider validation', () => {
  it('normalizes trailing slash and flags key presence', () => {
    const p = validateProvider({ id: 'p1', name: 'X', baseUrl: 'https://api.x.com/v1/', apiKey: 'sk-1' })
    expect(p.baseUrl).toBe('https://api.x.com/v1')
    expect(p.hasKey).toBe(true)
  })

  it('rejects bad urls and empty ids', () => {
    expect(() => validateProvider({ id: '', name: 'x', baseUrl: 'https://a/v1', apiKey: '' })).toThrowError(/id/)
    expect(() => validateProvider({ id: 'p', name: 'x', baseUrl: 'ftp://a', apiKey: '' })).toThrowError(/base URL/)
  })

  it('rejects a non-local http:// base URL (review E5)', () => {
    expect(() => validateProvider({ id: 'p-http', name: 'X', baseUrl: 'http://api.example.com/v1', apiKey: 'sk-x' })).toThrowError(/https/)
  })

  it('accepts http:// only for local debugging hosts (review E5)', () => {
    expect(validateProvider({ id: 'p-loc', name: 'L', baseUrl: 'http://localhost:8000/v1', apiKey: 'sk-x' }).baseUrl).toBe('http://localhost:8000/v1')
    expect(validateProvider({ id: 'p-loop', name: 'L', baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-x' }).baseUrl).toBe('http://127.0.0.1:8000/v1')
  })
})
