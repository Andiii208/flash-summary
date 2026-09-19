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
  /** Hard deadline: a hung gateway must not busy the UI forever (G0 finding
   *  2026-09-04: a large summarize call can hang the connection silently). */
  signal?: AbortSignal
}

/** Chat completions are slow (large multimodal summarize) but not infinite. */
export const CHAT_TIMEOUT_MS = 600_000
/** One ASR chunk (≤120s audio) should never take longer than this. */
export const ASR_TIMEOUT_MS = 300_000

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
      body: init.body as BodyInit,
      ...(init.signal != null ? { signal: init.signal } : {})
    })
  } catch (err) {
    // Surface the cause chain (ECONNRESET, ENOTFOUND, cert errors…) — a bare
    // "fetch failed" hides the actual transport failure.
    const cause = (err as { cause?: unknown }).cause
    const detail = cause != null ? ` (${String(cause).slice(0, 140)})` : ''
    throw new ProviderError('network', `network error: ${(err as Error).message}${detail}`)
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

/**
 * Base URLs whose multipart ASR endpoint is known absent (field-calibrated:
 * Xiaomi MiMo returns 404 for /audio/transcriptions and its openresty gateway
 * resets the connection on repeated large uploads to that path). Once a
 * platform is marked here, ASR goes straight to the chat-completions path —
 * the per-chunk multipart tax (and its flaky resets) is paid at most once
 * per session.
 */
export const chatOnlyAsrBaseUrls = new Set<string>()

export class OpenAiCompatibleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: ProviderFetch = defaultFetch
  ) {}

  private async request(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const serialized = JSON.stringify(body)
    let res
    try {
      // D6 (review): the caller's cancellation signal joins the hard
      // deadline — cancelling a task aborts the in-flight summarize.
      const timeout = AbortSignal.timeout(CHAT_TIMEOUT_MS)
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: serialized,
        signal: signal != null ? AbortSignal.any([timeout, signal]) : timeout
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
    // 批2 (audit 2026-09-19): 响应体前 200 字符不再进错误信息——provider 的
    // 错误页常回显请求（含 Authorization 头），body 白名单只留 status + kind。
    throw new ProviderError('bad_response', `provider returned HTTP ${res.status}`, res.status)
  }

  /**
   * ASR with transport fallback: OpenAI-standard multipart first; when the
   * platform does not expose /audio/transcriptions (404 or transport resets —
   * field case: Xiaomi MiMo routes ASR through chat completions), retry with
   * the chat-style input_audio path and remember the platform.
   */
  async transcribe(audio: Blob, fileName: string, model: string, language?: string): Promise<string> {
    if (!chatOnlyAsrBaseUrls.has(this.baseUrl)) {
      try {
        return await this.transcribeMultipart(audio, fileName, model, language)
      } catch (err) {
        const kind = err instanceof ProviderError ? err.kind : null
        // Fatal user-facing errors stay; anything suggesting a missing
        // endpoint (404, resets, other bad responses) falls back to chat.
        if (kind === 'auth' || kind === 'rate_limit') throw err
        chatOnlyAsrBaseUrls.add(this.baseUrl)
      }
    }
    return await this.transcribeChatAudio(audio, model, language)
  }

  /** POST /audio/transcriptions with a file + model. */
  private async transcribeMultipart(audio: Blob, fileName: string, model: string, language?: string): Promise<string> {
    const form = new FormData()
    form.append('file', audio, fileName)
    form.append('model', model)
    if (language != null) form.append('language', language)

    let res
    try {
      res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(ASR_TIMEOUT_MS)
      })
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause
      const detail = cause != null ? ` (${String(cause).slice(0, 140)})` : ''
      throw new ProviderError('network', `network error: ${(err as Error).message}${detail}`)
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError('auth', 'API key rejected — check the key in provider settings', res.status)
      }
      if (res.status === 429) {
        throw new ProviderError('rate_limit', 'provider rate limit reached — retry later', res.status)
      }
      // 批2 (audit 2026-09-19): 同上——错误体不再读、不再拼（这里连分类都不
      // 需要它），只留 HTTP status。
      throw new ProviderError('bad_response', `ASR returned HTTP ${res.status}`, res.status)
    }
    const payload = (await res.json()) as { text?: string }
    if (typeof payload.text !== 'string') {
      throw new ProviderError('bad_response', 'ASR response missing text field')
    }
    return payload.text
  }

  /**
   * Chat-completions ASR (MiMo field case 2026-09-02): the audio travels as
   * a base64 input_audio part; the transcript comes back as the message
   * content. The caller must keep the chunk small enough for the platform's
   * base64 size cap (~10 MB encoded).
   */
  private async transcribeChatAudio(audio: Blob, model: string, language?: string): Promise<string> {
    const bytes = Buffer.from(await audio.arrayBuffer())
    const dataUrl = `data:audio/wav;base64,${bytes.toString('base64')}`
    const payload = await this.request('/chat/completions', {
      model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'input_audio', input_audio: { data: dataUrl } }]
        }
      ],
      ...(language != null && language !== 'auto' ? { asr_options: { language } } : {})
    })
    const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
    // An empty transcript is a valid answer (silent audio) — the caller
    // decides whether that is fatal; only a malformed shape throws here.
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      // Part-array responses: concatenate the text parts in order.
      const text = content
        .map((p) => (p != null && typeof p === 'object' && (p as Record<string, unknown>)['text'] != null ? String((p as Record<string, unknown>)['text']) : ''))
        .join('')
      return text
    }
    throw new ProviderError('bad_response', 'ASR chat response missing transcript content')
  }

  /** Chat completions with optional multimodal parts. */
  async chat(messages: ChatMessage[], model: string, maxTokens?: number): Promise<string> {
    return await this.complete('/chat/completions', { model, messages, ...(maxTokens != null ? { max_tokens: maxTokens } : {}) })
  }

  /**
   * Chat completions with the JSON response mode (platform-supported on
   * mimo-v2.5, field-checked 2026-09-02). Use for structured outputs; the
   * caller still parses defensively.
   */
  async chatJson(messages: ChatMessage[], model: string, maxTokens?: number, signal?: AbortSignal): Promise<string> {
    return await this.complete('/chat/completions', {
      model,
      messages,
      ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
      response_format: { type: 'json_object' }
    }, signal)
  }

  private async complete(path: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const response = (await this.request(path, payload, signal)) as { choices?: Array<{ message?: { content?: string } }> }
    const content = response.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new ProviderError('bad_response', 'chat response missing content')
    }
    return content
  }
}
