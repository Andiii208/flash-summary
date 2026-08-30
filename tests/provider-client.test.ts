import { describe, expect, it } from 'vitest'
import { OpenAiCompatibleClient, ProviderError, type ChatPart } from '../src/main/providers/openai-client'

interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

function fetchJson(status: number, body: unknown, calls: RecordedCall[]) {
  return async (url: string, init: { headers: Record<string, string>; method: string; body: unknown }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    }
  }
}

function fetchText(status: number, text: string, calls: RecordedCall[]) {
  return async (url: string, init: { headers: Record<string, string>; method: string; body: unknown }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        throw new Error('not json')
      },
      text: async () => text
    }
  }
}

describe('OpenAiCompatibleClient.chat (mock HTTP)', () => {
  it('sends bearer auth and returns content', async () => {
    const calls: RecordedCall[] = []
    const client = new OpenAiCompatibleClient(
      'https://api.x.com/v1',
      'sk-secret',
      fetchJson(200, { choices: [{ message: { content: '你好' } }] }, calls)
    )
    const out = await client.chat([{ role: 'user', content: '总结' }], 'gpt-4o', 500)
    expect(out).toBe('你好')
    expect(calls[0].headers.Authorization).toBe('Bearer sk-secret')
    expect(calls[0].body).toMatchObject({ model: 'gpt-4o', max_tokens: 500 })
  })

  it('sends multimodal image parts', async () => {
    const calls: RecordedCall[] = []
    const client = new OpenAiCompatibleClient(
      'https://api.x.com/v1',
      'sk-secret',
      fetchJson(200, { choices: [{ message: { content: 'ok' } }] }, calls)
    )
    const parts: ChatPart[] = [
      { type: 'text', text: '这两张图有什么区别' },
      { type: 'image_url', imageUrl: 'data:image/jpeg;base64,AAAA' },
      { type: 'image_url', imageUrl: 'data:image/jpeg;base64,BBBB' }
    ]
    await client.chat([{ role: 'user', content: parts }], 'gpt-4o')
    const body = calls[0].body as { messages: Array<{ content: ChatPart[] }> }
    expect(body.messages[0].content).toHaveLength(3)
  })

  it('maps 401 to auth error with actionable message', async () => {
    const client = new OpenAiCompatibleClient('https://api.x.com/v1', 'bad', fetchText(401, 'unauthorized', []))
    await expect(client.chat([], 'm')).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'auth',
      status: 401
    })
  })

  it('maps 429 to rate_limit', async () => {
    const client = new OpenAiCompatibleClient('https://api.x.com/v1', 'k', fetchText(429, 'slow down', []))
    await expect(client.chat([], 'm')).rejects.toMatchObject({ kind: 'rate_limit' })
  })

  it('maps image-rejecting 400 to unsupported_visual', async () => {
    const client = new OpenAiCompatibleClient(
      'https://api.x.com/v1',
      'k',
      fetchText(400, 'this model does not support image input', [])
    )
    await expect(
      client.chat([{ role: 'user', content: [{ type: 'image_url', imageUrl: 'x' }] }], 'text-only-model')
    ).rejects.toMatchObject({ kind: 'unsupported_visual' })
  })

  it('maps transport failure to network', async () => {
    const client = new OpenAiCompatibleClient('https://api.x.com/v1', 'k', async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(client.chat([], 'm')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('ASR transcriptions (mock HTTP via FormData-free shim)', () => {
  it('returns text from a 200 payload', async () => {
    // transcribe uses global fetch; swap in a stub via vi.stubGlobal-like approach.
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ text: '这是转写文本' })
      }) as unknown as Response) as unknown as typeof fetch
    try {
      const client = new OpenAiCompatibleClient('https://api.x.com/v1', 'sk-1')
      const blob = new Blob(['fake-wav-bytes'])
      const text = await client.transcribe(blob, 'audio.wav', 'whisper-1')
      expect(text).toBe('这是转写文本')
    } finally {
      globalThis.fetch = original
    }
  })

  it('maps ASR 401 to auth error', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      ({ ok: false, status: 401, text: async () => 'denied' }) as unknown as Response) as unknown as typeof fetch
    try {
      const client = new OpenAiCompatibleClient('https://api.x.com/v1', 'bad')
      await expect(client.transcribe(new Blob(['x']), 'a.wav', 'whisper-1')).rejects.toMatchObject({ kind: 'auth' })
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('ProviderError kinds', () => {
  it('exposes machine-readable kinds', () => {
    expect(new ProviderError('auth', 'x').kind).toBe('auth')
    expect(new ProviderError('unsupported_visual', 'x').kind).toBe('unsupported_visual')
    expect(new ProviderError('rate_limit', 'x').kind).toBe('rate_limit')
    expect(new ProviderError('network', 'x').kind).toBe('network')
    expect(new ProviderError('bad_response', 'x').kind).toBe('bad_response')
  })
})
