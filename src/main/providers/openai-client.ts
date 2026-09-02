/**
 * OpenAI-compatible client for ASR (audio transcriptions) and chat
 * completions (multimodal/text). Error taxonomy maps HTTP outcomes to
 * user-actionable kinds (spec §11.10):
 * - auth:            401/403 → check API key
 * - unsupported_visual: provider rejected image input → switch model
 * - rate_limit:      429 → retry later
 * - network:         transport failure
 * - bad_response:    anything else unexpected
 */
export type ProviderErrorKind =
  | 'auth'
  | 'unsupported_visual'
  | 'rate_limit'
  | 'network'
  | 'bad_response'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly status?: number

  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.status = status
  }
}

export interface ProviderFetchInit {
  headers: Record<string, string>
  method: string
  body: unknown
}

export interface ProviderFetch {
  (url: string, init: ProviderFetchInit): Promise<{
    ok: boolean
    status: number
    json: () => Promise<unknown>
    text: () => Promise<string>
  }>
}

const defaultFetch: ProviderFetch = async (url, init) => {
  try {
    return await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit
    })
  } catch (err) {
    throw new ProviderError('network', `network error: ${(err as Error).message}`)
  }
}

export interface ChatImagePart {
  type: 'image_url'
  imageUrl: string
}

export interface ChatTextPart {
  type: 'text'
  text: string
}

export type ChatPart = ChatTextPart | ChatImagePart

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatPart[]
}

export class OpenAiCompatibleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: ProviderFetch = defaultFetch
  ) {}

  private async request(path: string, body: unknown): Promise<unknown> {
    let res
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body
      })
    } catch (err) {
      if (err instanceof ProviderError) throw err
      throw new ProviderError('network', `network error: ${(err as Error).message}`)
    }

    if (res.ok) {
      return res.json()
    }

    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('auth', 'API key rejected — check the key in provider settings', res.status)
    }
    if (res.status === 429) {
      throw new ProviderError('rate_limit', 'provider rate limit reached — retry later', res.status)
    }
    if (res.status === 400 && /image|visual|multimodal|vision/i.test(text)) {
      throw new ProviderError('unsupported_visual', 'model does not accept image input — bind a multimodal model', res.status)
    }
    throw new ProviderError('bad_response', `provider returned ${res.status}: ${text.slice(0, 200)}`, res.status)
  }

  /** POST /audio/transcriptions with a file + model. */
  async transcribe(audio: Blob, fileName: string, model: string, language?: string): Promise<string> {
    const form = new FormData()
    form.append('file', audio, fileName)
    form.append('model', model)
    if (language != null) form.append('language', language)

    let res
    try {
      res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form
      })
    } catch (err) {
      throw new ProviderError('network', `network error: ${(err as Error).message}`)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError('auth', 'API key rejected — check the key in provider settings', res.status)
      }
      if (res.status === 429) {
        throw new ProviderError('rate_limit', 'provider rate limit reached — retry later', res.status)
      }
      throw new ProviderError('bad_response', `ASR returned ${res.status}: ${text.slice(0, 200)}`, res.status)
    }
    const payload = (await res.json()) as { text?: string }
    if (typeof payload.text !== 'string') {
      throw new ProviderError('bad_response', 'ASR response missing text field')
    }
    return payload.text
  }

  /** Chat completions with optional multimodal parts. */
  async chat(messages: ChatMessage[], model: string, maxTokens?: number): Promise<string> {
    const payload = await this.request('/chat/completions', {
      model,
      messages,
      ...(maxTokens != null ? { max_tokens: maxTokens } : {})
    })
    const content = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new ProviderError('bad_response', 'chat response missing content')
    }
    return content
  }
}
