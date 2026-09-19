import { describe, expect, it } from 'vitest'
import { OpenAiCompatibleClient, ProviderError, chatOnlyAsrBaseUrls, type ChatPart } from '../src/main/providers/openai-client'

interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  signal?: AbortSignal
}

function fetchJson(status: number, body: unknown, calls: RecordedCall[]) {
  return async (url: string, init: { headers: Record<string, string>; method: string; body: unknown; signal?: AbortSignal }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body, signal: init.signal })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    }
  }
}

function fetchText(status: number, text: string, calls: RecordedCall[]) {
  return async (url: string, init: { headers: Record<string, string>; method: string; body: unknown; signal?: AbortSignal }) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body, signal: init.signal })
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
    // Field case 2026-09-02: the body must be a JSON string — undici sends a
    // plain object as the literal "[object Object]".
    expect(typeof calls[0].body).toBe('string')
    expect(JSON.parse(calls[0].body as string)).toMatchObject({ model: 'gpt-4o', max_tokens: 500 })
  })

  it('attaches a hard abort deadline to chat requests (G0 hang case 2026-09-04)', async () => {
    const calls: RecordedCall[] = []
    const client = new OpenAiCompatibleClient(
      'https://api.x.com/v1',
      'sk-secret',
      fetchJson(200, { choices: [{ message: { content: 'ok' } }] }, calls)
    )
    await client.chatJson([{ role: 'user', content: 'q' }], 'gpt-4o')
    expect(calls[0].signal).toBeInstanceOf(AbortSignal)
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
    const body = JSON.parse(calls[0].body as string) as { messages: Array<{ content: ChatPart[] }> }
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

  it('falls back to chat-style input_audio ASR when the multipart endpoint 404s (MiMo case)', async () => {
    chatOnlyAsrBaseUrls.delete('https://api.xiaomimimo.com/v1')
    const original = globalThis.fetch
    const calls: Array<{ url: string; body: string }> = []
    globalThis.fetch = (async (url: string, init: { body?: BodyInit }) => {
      calls.push({ url, body: typeof init.body === 'string' ? init.body : '' })
      if (String(url).endsWith('/audio/transcriptions')) {
        return { ok: false, status: 404, text: async () => '<html>404 Not Found</html>' } as unknown as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '回退路径的转写文本' } }] })
      } as unknown as Response
    }) as unknown as typeof fetch
    try {
      const client = new OpenAiCompatibleClient('https://api.xiaomimimo.com/v1', 'sk-1')
      const text = await client.transcribe(new Blob(['fake-wav']), 'chunk-0.wav', 'mimo-v2.5-asr')
      expect(text).toBe('回退路径的转写文本')
      expect(calls).toHaveLength(2)
      expect(calls[1].url).toBe('https://api.xiaomimimo.com/v1/chat/completions')
      expect(calls[1].body).toContain('"type":"input_audio"')
      expect(calls[1].body).toContain('"model":"mimo-v2.5-asr"')
      expect(calls[1].body).toContain('data:audio/wav;base64,')

      // Once marked, later chunks skip the multipart probe entirely (the
      // gateway resets repeated large uploads to the missing endpoint).
      calls.length = 0
      await client.transcribe(new Blob(['fake-wav']), 'chunk-1.wav', 'mimo-v2.5-asr')
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://api.xiaomimimo.com/v1/chat/completions')
    } finally {
      globalThis.fetch = original
      chatOnlyAsrBaseUrls.delete('https://api.xiaomimimo.com/v1')
    }
  })

  it('marks the platform and falls back when the multipart leg transport-fails', async () => {
    chatOnlyAsrBaseUrls.delete('https://flaky.example/v1')
    const original = globalThis.fetch
    const attempts: string[] = []
    globalThis.fetch = (async (url: string) => {
      attempts.push(String(url))
      if (String(url).endsWith('/audio/transcriptions')) {
        throw Object.assign(new Error('fetch failed'), { cause: new Error('write ECONNRESET') })
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '语音内容' } }] }) } as unknown as Response
    }) as unknown as typeof fetch
    try {
      const client = new OpenAiCompatibleClient('https://flaky.example/v1', 'sk-1')
      const text = await client.transcribe(new Blob(['x']), 'a.wav', 'm')
      expect(text).toBe('语音内容')
      expect(attempts.some((u) => u.endsWith('/chat/completions'))).toBe(true)
    } finally {
      globalThis.fetch = original
      chatOnlyAsrBaseUrls.delete('https://flaky.example/v1')
    }
  })

  it('treats auth failures on the multipart leg as fatal (no chat fallback)', async () => {
    chatOnlyAsrBaseUrls.delete('https://authfail.example/v1')
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      ({ ok: false, status: 401, text: async () => 'denied' }) as unknown as Response) as unknown as typeof fetch
    try {
      const client = new OpenAiCompatibleClient('https://authfail.example/v1', 'bad')
      await expect(client.transcribe(new Blob(['x']), 'a.wav', 'm')).rejects.toMatchObject({ kind: 'auth' })
    } finally {
      globalThis.fetch = original
      chatOnlyAsrBaseUrls.delete('https://authfail.example/v1')
    }
  })

  it('returns empty string (not an error) when the ASR transcript is empty', async () => {
    chatOnlyAsrBaseUrls.delete('https://silent.example/v1')
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) }) as unknown as Response) as unknown as typeof fetch
    try {
      const client = new OpenAiCompatibleClient('https://silent.example/v1', 'sk-1')
      chatOnlyAsrBaseUrls.add('https://silent.example/v1')
      const text = await client.transcribe(new Blob(['x']), 'a.wav', 'm')
      expect(text).toBe('')
    } finally {
      globalThis.fetch = original
      chatOnlyAsrBaseUrls.delete('https://silent.example/v1')
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

describe('批2 — provider 错误体白名单（status + kind，不留 body 原文）', () => {
  it('chat 的 bad_response 只带 HTTP status，不回显响应体', async () => {
    // A provider echoing the request (key included) in its 500 body must not
    // ride along into the user-visible error message.
    const body = 'upstream leaked Authorization: Bearer sk-super-secret-key-123 in its 500 page'
    const client = new OpenAiCompatibleClient('https://api.x.com/v1', 'k', fetchText(500, body, []))
    const error = await client.chat([], 'm').then(
      () => null,
      (e: unknown) => e as ProviderError
    )
    expect(error).toBeInstanceOf(ProviderError)
    expect(error!.kind).toBe('bad_response')
    expect(error!.status).toBe(500)
    expect(error!.message).toContain('500')
    expect(error!.message).not.toContain('sk-super-secret-key-123')
    expect(error!.message).not.toContain('upstream')
  })

  it('ASR 的 bad_response 同样只带 HTTP status', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      ({ ok: false, status: 502, text: async () => 'gateway dumped sk-another-secret-key-456' }) as unknown as Response) as unknown as typeof fetch
    try {
      const client = new OpenAiCompatibleClient('https://api.x.com/v1', 'bad')
      const error = await client.transcribe(new Blob(['x']), 'a.wav', 'whisper-1').then(
        () => null,
        (e: unknown) => e as ProviderError
      )
      expect(error).toBeInstanceOf(ProviderError)
      expect(error!.kind).toBe('bad_response')
      expect(error!.status).toBe(502)
      expect(error!.message).toContain('502')
      expect(error!.message).not.toContain('sk-another-secret-key-456')
    } finally {
      globalThis.fetch = original
      chatOnlyAsrBaseUrls.delete('https://api.x.com/v1')
    }
  })
})
