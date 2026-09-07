/**
 * Bilibili web API client over an injectable fetch (plan 2026-09-06 M2).
 *
 * Calls the same JSON endpoints the web player uses, with the user's own
 * SESSDATA cookie when logged in (AI/CC subtitles require a login; video
 * metadata does not). Responses are parsed by pure functions in parse.ts.
 * Signed stream URLs are returned to the caller like SEU auth_key links:
 * they must only live in task_stage_outputs, never in lessons rows or logs.
 */
import type { BiliSubtitleEntry, BiliSubtitleSegment } from './subtitle'
import { parseSubtitleBody } from './subtitle'
import {
  parseDashStreams,
  parsePlayerInfo,
  parseViewInfo,
  type BiliDashStreams,
  type BiliViewInfo
} from './parse'
import { extractWbiKeys, signedPlayUrlParams, wbiSign, WBI_KEY_TTL_MS, type WbiKeys } from './wbi'
import { buildDmImgParams } from './dm-params'
import { cookiesFromCrossDomainUrl, cookiesFromSetCookieHeader, parseQrGenerate, qrStatusFromCode, type QrGenerateResult, type QrPollStatus } from './qr-login'

const DEFAULT_API_HOST = 'https://api.bilibili.com'
const DEFAULT_PASSPORT_HOST = 'https://passport.bilibili.com'
/**
 * The passport endpoints gate the QR state on the Referer: with the main-site
 * referer the poll keeps answering 86101 (未扫码) even after the phone
 * confirmed — the QR expires server-side while we wait. The official login
 * page's own referer + params (captured 2026-09-07) make the state visible.
 */
const PASSPORT_REFERER = 'https://passport.bilibili.com/login'
const QR_GENERATE_PARAMS = 'source=main_web&go_url=&web_location=333.1228&x-bili-redirect=1'
const QR_POLL_PARAMS = 'source=main_web&web_location=333.1228&x-bili-redirect=1'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
export const BILI_TIMEOUT_MS = 30_000

export type BiliApiErrorKind =
  | 'network'
  | 'bad_response'
  | 'auth_required'
  | 'forbidden'
  | 'not_found'
  | 'risk_control'

export class BilibiliApiError extends Error {
  readonly kind: BiliApiErrorKind

  constructor(kind: BiliApiErrorKind, message: string) {
    super(message)
    this.name = 'BilibiliApiError'
    this.kind = kind
  }
}

export interface FetchLike {
  (
    url: string,
    init?: { headers?: Record<string, string>; redirect?: 'manual' | 'follow'; signal?: AbortSignal }
  ): Promise<{
    ok: boolean
    status: number
    headers: { get(name: string): string | null }
    url: string
    json: () => Promise<unknown>
    text: () => Promise<string>
    arrayBuffer: () => Promise<ArrayBuffer>
  }>
}

interface Envelope {
  code: number
  message: string
  data: unknown
}

export class BilibiliClient {
  private wbiKeys: WbiKeys | null = null
  private wbiKeysFetchedAt = 0

  constructor(
    /** SESSDATA cookie string («SESSDATA=…; bili_jct=…»), empty when logged out. */
    private readonly getCookie: () => Promise<string>,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs: number = BILI_TIMEOUT_MS,
    /** Host injectables (e2e tests point them at a local fake server). */
    private readonly apiHost: string = DEFAULT_API_HOST,
    private readonly passportHost: string = DEFAULT_PASSPORT_HOST
  ) {}

  /** One JSON API call with the envelope code mapped onto the error taxonomy. */
  private async requestEnvelope(
    url: string,
    withCookie: boolean,
    options: { tolerateCodes?: number[]; referer?: string } = {}
  ): Promise<Envelope> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Referer: options.referer ?? 'https://www.bilibili.com/'
    }
    if (withCookie) {
      const cookie = await this.getCookie()
      if (cookie !== '') headers.Cookie = cookie
    }
    let res
    let timer: NodeJS.Timeout | undefined
    try {
      res = await Promise.race([
        this.fetchImpl(url, { headers, redirect: 'manual' }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new BilibiliApiError('network', `bilibili API timeout for ${pathOnly(url)}`)), this.timeoutMs)
        })
      ])
    } catch (err) {
      if (err instanceof BilibiliApiError) throw err
      throw new BilibiliApiError('network', `network error contacting bilibili: ${(err as Error).message}`)
    } finally {
      if (timer != null) clearTimeout(timer)
    }
    if (res.status === 412) {
      throw new BilibiliApiError('risk_control', `bilibili risk control (HTTP 412) for ${pathOnly(url)}`)
    }
    if (!res.ok) {
      throw new BilibiliApiError('bad_response', `bilibili API returned ${res.status} for ${pathOnly(url)}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(await res.text())
    } catch {
      throw new BilibiliApiError('bad_response', `bilibili API returned non-JSON for ${pathOnly(url)}`)
    }
    return readEnvelope(payload, options.tolerateCodes ?? [])
  }

  /** The nav endpoint answers code -101 (logged out) but still carries wbi_img. */
  async getWbiKeys(): Promise<WbiKeys> {
    if (this.wbiKeys != null && Date.now() - this.wbiKeysFetchedAt < WBI_KEY_TTL_MS) return this.wbiKeys
    const payload = await this.requestEnvelope(`${this.apiHost}/x/web-interface/nav`, false, { tolerateCodes: [-101] })
    const keys = extractWbiKeys(payload)
    if (keys == null) throw new BilibiliApiError('bad_response', 'bilibili nav payload missing wbi_img keys')
    this.wbiKeys = keys
    this.wbiKeysFetchedAt = Date.now()
    return keys
  }

  async viewInfo(bvid: string): Promise<BiliViewInfo> {
    const payload = await this.requestEnvelope(`${this.apiHost}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, false)
    const info = parseViewInfo(payload)
    if (info == null) throw new BilibiliApiError('bad_response', `bilibili view payload unusable for ${bvid}`)
    return info
  }

  /** Subtitle tracks; empty without a login (need_login_subtitle=true). */
  async subtitleTracks(bvid: string, cid: number): Promise<{ subtitles: BiliSubtitleEntry[]; needLoginSubtitle: boolean }> {
    const params = new URLSearchParams({ bvid, cid: String(cid) }).toString()
    const payload = await this.requestEnvelope(`${this.apiHost}/x/player/wbi/v2?${params}`, true)
    const info = parsePlayerInfo(payload)
    if (info == null) throw new BilibiliApiError('bad_response', `bilibili player payload unusable for ${bvid}`)
    return { subtitles: info.subtitles, needLoginSubtitle: info.needLoginSubtitle }
  }

  /** Download one subtitle file (the URL is pre-signed by Bilibili). */
  async fetchSubtitleBody(subtitleUrl: string): Promise<BiliSubtitleSegment[]> {
    const url = subtitleUrl.startsWith('//') ? `https:${subtitleUrl}` : subtitleUrl
    const payload = await this.requestEnvelope(url, true)
    return parseSubtitleBody(payload.data)
  }

  /**
   * Cover image → data URL (import-preview thumbnail). The renderer CSP is
   * `img-src 'self' data:` — remote images must be proxied through main as
   * data URLs, never loaded directly. Best-effort: any failure returns null
   * and the preview falls back to a monogram block.
   */
  async fetchImageAsDataUrl(url: string, maxBytes = 1024 * 1024): Promise<string | null> {
    let res
    try {
      res = await this.fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com/' }
      })
    } catch {
      return null
    }
    if (!res.ok) return null
    const mime = res.headers.get('content-type') ?? ''
    if (!mime.startsWith('image/')) return null
    try {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0 || buf.length > maxBytes) return null
      return `data:${mime.split(';')[0]};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }

  /**
   * DASH stream candidates via the WBI-signed playurl gateway (dm_img
   * risk-control params included; qn=32 is the 480P ceiling we allow —
   * paid-quality tiers are never requested).
   */
  async dashStreams(bvid: string, cid: number): Promise<BiliDashStreams> {
    const keys = await this.getWbiKeys()
    const base = { bvid, cid: String(cid), qn: '32', fnval: '16', fourk: '0', try_look: '1' }
    const signed = signedPlayUrlParams(base, keys, buildDmImgParams(), Math.floor(Date.now() / 1000))
    const query = new URLSearchParams(signed).toString()
    const payload = await this.requestEnvelope(`${this.apiHost}/x/player/wbi/playurl?${query}`, true)
    const streams = parseDashStreams(payload)
    if (streams == null) throw new BilibiliApiError('bad_response', `bilibili playurl payload unusable for ${bvid}`)
    return streams
  }

  /** b23.tv short links answer with a redirect to the full /video/BV… URL. */
  async resolveShortLink(shortUrl: string): Promise<string> {
    const headers = { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com/' }
    let res
    let timer: NodeJS.Timeout | undefined
    try {
      res = await Promise.race([
        this.fetchImpl(shortUrl, { headers, redirect: 'manual' }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new BilibiliApiError('network', `bilibili short-link timeout for ${shortUrl}`)), this.timeoutMs)
        })
      ])
    } catch (err) {
      if (err instanceof BilibiliApiError) throw err
      throw new BilibiliApiError('network', `network error resolving short link: ${(err as Error).message}`)
    } finally {
      if (timer != null) clearTimeout(timer)
    }
    const location = res.headers.get('location') ?? ''
    if (res.status >= 300 && res.status < 400 && location !== '') return location
    return res.url
  }

  /** Signed params for an arbitrary WBI endpoint (qr-login does not need this). */
  async signParams(params: Record<string, string>): Promise<Record<string, string>> {
    const keys = await this.getWbiKeys()
    return wbiSign(params, keys, Math.floor(Date.now() / 1000))
  }

  /** QR login step 1: the payload whose `url` the renderer renders as a QR image. */
  async qrGenerate(): Promise<QrGenerateResult> {
    const payload = await this.requestEnvelope(
      `${this.passportHost}/x/passport-login/web/qrcode/generate?${QR_GENERATE_PARAMS}`,
      false,
      { referer: PASSPORT_REFERER }
    )
    const parsed = parseQrGenerate(payload)
    if (parsed == null) throw new BilibiliApiError('bad_response', 'bilibili qr generate payload unusable')
    return parsed
  }

  /**
   * QR login step 2: one poll of the scan state. On confirmation the login
   * cookies come out of the crossDomain handoff URL — in-memory only,
   * returned to the caller for encrypted persistence, never logged.
   *
   * The confirm step answers in TWO shapes (doc: web端扫码登录 / 旧版):
   * 200 JSON {data:{code:0,url}} or a legacy 302 whose Location IS the
   * crossDomain handoff URL. redirect:'manual' + treating 3xx as an error
   * consumed the one-shot confirm — the next poll only ever said 86038
   * (field case 2026-09-07: log showed scanned → expired, no confirmed).
   */
  async qrPoll(qrcodeKey: string): Promise<{ status: QrPollStatus; cookies: string | null }> {
    const query = new URLSearchParams({ qrcode_key: qrcodeKey }).toString()
    const url = `${this.passportHost}/x/passport-login/web/qrcode/poll?${query}&${QR_POLL_PARAMS}`
    const headers = { 'User-Agent': USER_AGENT, Referer: PASSPORT_REFERER }
    let res
    let timer: NodeJS.Timeout | undefined
    try {
      res = await Promise.race([
        this.fetchImpl(url, { headers, redirect: 'manual' }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new BilibiliApiError('network', `bilibili qr poll timeout for ${pathOnly(url)}`)), this.timeoutMs)
        })
      ])
    } catch (err) {
      if (err instanceof BilibiliApiError) throw err
      throw new BilibiliApiError('network', `network error polling bilibili qr: ${(err as Error).message}`)
    } finally {
      if (timer != null) clearTimeout(timer)
    }
    if (res.status === 412) {
      throw new BilibiliApiError('risk_control', 'bilibili qr poll risk control (HTTP 412)')
    }
    // Legacy confirm shape: 3xx — Location or Set-Cookie carries the login.
    if (res.status >= 300 && res.status < 400) {
      const cookies =
        cookiesFromCrossDomainUrl(res.headers.get('location') ?? '') ??
        cookiesFromSetCookieHeader(res.headers.get('set-cookie') ?? '')
      if (cookies == null) throw new BilibiliApiError('bad_response', 'bilibili qr poll redirected without SESSDATA')
      return { status: 'confirmed', cookies }
    }
    if (!res.ok) {
      throw new BilibiliApiError('bad_response', `bilibili qr poll returned ${res.status}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(await res.text())
    } catch {
      throw new BilibiliApiError('bad_response', 'bilibili qr poll returned non-JSON')
    }
    const envelope = readEnvelope(payload, [])
    const data = (envelope.data ?? {}) as { code?: unknown; url?: unknown }
    const code = typeof data.code === 'number' ? data.code : -1
    const status = qrStatusFromCode(code)
    if (status !== 'confirmed') return { status, cookies: null }
    // Login cookies ride EITHER the crossDomain URL (data.url, doc shape) OR
    // the response's Set-Cookie headers (field case 2026-09-07: url was empty,
    // the poll failed with «no SESSDATA» and the one-shot confirm was lost).
    const cookies =
      cookiesFromCrossDomainUrl(typeof data.url === 'string' ? data.url : '') ??
      cookiesFromSetCookieHeader(res.headers.get('set-cookie') ?? '')
    if (cookies == null) {
      const urlEmpty = typeof data.url !== 'string' || data.url === ''
      const hasSetCookie = (res.headers.get('set-cookie') ?? '') !== ''
      throw new BilibiliApiError(
        'bad_response',
        `bilibili qr poll confirmed but no SESSDATA extractable (urlEmpty=${urlEmpty}, setCookie=${hasSetCookie}, dataKeys=${Object.keys(data).join('|')})`
      )
    }
    return { status, cookies }
  }
}

function readEnvelope(payload: unknown, tolerateCodes: number[]): Envelope {
  const code = (payload as { code?: unknown }).code
  const data = (payload as { data?: unknown }).data
  const message = typeof (payload as { message?: unknown }).message === 'string' ? (payload as { message: string }).message : ''
  if (typeof code !== 'number') {
    // Subtitle files and some CDNs answer bare JSON without an envelope.
    return { code: 0, message: '', data: payload }
  }
  if (code !== 0 && !tolerateCodes.includes(code)) {
    throw classifyEnvelopeError(code, message)
  }
  return { code, message, data }
}

function classifyEnvelopeError(code: number, message: string): BilibiliApiError {
  if (code === -101) return new BilibiliApiError('auth_required', `bilibili session required/expired (-101): ${message || '请重新扫码登录'}`)
  if (code === -403) return new BilibiliApiError('forbidden', `bilibili access denied (-403): ${message}`)
  if (code === -404) return new BilibiliApiError('not_found', `bilibili video not found (-404): ${message}`)
  return new BilibiliApiError('bad_response', `bilibili API error ${code}: ${message}`)
}

function pathOnly(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return '(unparsable url)'
  }
}
