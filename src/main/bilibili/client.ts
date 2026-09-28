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

/** 可中止的等待（批 A3-① 重试阶梯用）：取消信号到达时立即 reject，不等满定时器。 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('任务已取消'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('任务已取消'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
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
  /**
   * H1 (audit 2026-09-28): 出站白名单拒绝。单独一个 kind 而不复用
   * forbidden/bad_response——那两个的语义是「B 站服务器回了 -403/坏响应」，
   * 本地的安全拒绝写成服务器的响应是在日志里撒谎；调用方（pipeline 的降级
   * 分流、错误归类）也从此能区分「服务器拒绝」与「我们拒绝」。
   */
  | 'blocked_host'

export class BilibiliApiError extends Error {
  readonly kind: BiliApiErrorKind

  constructor(kind: BiliApiErrorKind, message: string) {
    super(message)
    this.name = 'BilibiliApiError'
    this.kind = kind
  }
}

/**
 * H1 (audit 2026-09-28): 出站主机白名单。
 *
 * 为什么要它：这个 client 的 URL 不全是自己拼的——subtitle_url 来自 player
 * 接口响应体、封面 pic 来自 view 接口响应体、短链则是渲染层原样透传的输入。
 * 响应体能指定任意主机时，带着 SESSDATA 的请求就会把登录态送到那个主机
 * （SSRF + 会话外带，导入一个字幕轨指向外部主机的视频即触发）。所以所有
 * 出站 URL 都在这里钉死在 B 站自己的域名上。
 *
 * D1（plan 2026-09-28 决策项，已裁「含」）：CDN 主机现场取证（tests/ 里的录制
 * 夹具）就是 cover/subtitle 的落点，*.hdslb.com / *.bilivideo.{com,cn} /
 * *.akamaized.net 一并收进来——宁可写明文放行，不要为了让导入「碰巧能用」而
 * 放松 host 判定。
 *
 * 条目写法：裸 host = 只放行 https（默认集合的安全面）；显式写 scheme 的
 * 条目（`http://127.0.0.1`）= 只放行该 scheme，给注入 localhost fake server
 * 的单测/e2e 留缝（真实 B 站端点不会也不需要 http）。
 */
export const BILIBILI_ALLOWED_HOSTS: readonly string[] = [
  'www.bilibili.com',
  'api.bilibili.com',
  'passport.bilibili.com',
  'b23.tv',
  '.hdslb.com',
  '.bilivideo.com',
  // 现场取证（Recorded fixtures in tests/bilibili-client.test.ts）显示 B 站媒体
  // CDN 同时出现在 .com 与 .cn 两个后缀下（upos-sz-mirrorcos.bilivideo.com /
  // xy.mcdn.bilivideo.cn），两个都收——漏一个就是真实导入被自己人拒掉。
  '.bilivideo.cn',
  '.akamaized.net'
]

/** 拒绝原因分类：调用方据此给人话文案（scheme 与 host 是两种不同的误操作）。 */
type UrlRejection = 'unparsable' | 'scheme' | 'host'

/** 条目 → (scheme, hostPattern)；裸 host 条目的 scheme 为 null（隐含 https）。 */
function splitHostEntry(entry: string): { scheme: string | null; host: string } {
  const match = /^(https?):\/\/(.+)$/i.exec(entry.trim())
  if (match != null) return { scheme: `${match[1]!.toLowerCase()}:`, host: match[2]!.trim() }
  return { scheme: null, host: entry.trim() }
}

/**
 * host 命中判定：条目带前导点时按「.后缀」匹配（`.hdslb.com` 匹配
 * `i0.hdslb.com`），否则精确匹配。前导点是安全边界本身——少了它，
 * `evilb23.tv` 这种相邻租用域名就能 endsWith 骗过 `b23.tv`；
 * 带上前导点后，`hdslb.com.evil.com` 结尾是 `.evil.com`，永远命中不了
 * `.hdslb.com`。
 */
function hostMatches(hostPattern: string, hostname: string): boolean {
  const pattern = hostPattern.toLowerCase()
  return pattern.startsWith('.') ? hostname.endsWith(pattern) : hostname === pattern
}

/** null = 放行；否则是拒绝原因（不可解析 / scheme 不符 / host 不在白名单）。 */
function rejectUrl(url: string, allowedHosts: readonly string[]): UrlRejection | null {
  const parsed = parseUrlLoose(url)
  if (parsed == null) return 'unparsable'
  const hostname = parsed.hostname.toLowerCase()
  // host 先判：主机都不在白名单里时，说「host 不被允许」比说「scheme」准确。
  const hostListed = allowedHosts.some((entry) => hostMatches(splitHostEntry(entry).host, hostname))
  if (!hostListed) return 'host'
  const schemeOk = allowedHosts.some((entry) => {
    const { scheme, host } = splitHostEntry(entry)
    return parsed.protocol === (scheme ?? 'https:') && hostMatches(host, hostname)
  })
  return schemeOk ? null : 'scheme'
}

/** new URL 的宽容版：缺 scheme 的输入按 https 补一个再解析（用户粘贴常被聊天软件砍掉协议头）。 */
function parseUrlLoose(input: string): URL | null {
  try {
    return new URL(input)
  } catch {
    try {
      return new URL(`https://${input}`)
    } catch {
      return null
    }
  }
}

/** H1: 出站 URL 是否放行（scheme + host 双查）。不可解析的输入一律不放行。 */
export function isAllowedBilibiliUrl(url: string, allowedHosts: readonly string[]): boolean {
  return rejectUrl(url, allowedHosts) === null
}

/**
 * H1: requestEnvelope / fetchImageAsDataUrl / resolveShortLink 的统一入口校验。
 * 拒绝时抛 `blocked_host`——不复用 forbidden/bad_response：那两个 kind 的语义是
 * 「B 站服务器这么回」，把本地安全拒绝写成服务器的响应等于在日志里撒谎。
 *
 * 为什么不是「剥 cookie 放行」：不带 cookie 的盲 SSRF 仍然是 SSRF（内网探测 /
 * 端口扫描 / 借道请求），白名单要是一道边界，不是一个 cookie 过滤器。
 */
export function assertAllowedBilibiliUrl(url: string, allowedHosts: readonly string[]): void {
  const reason = rejectUrl(url, allowedHosts)
  if (reason === null) return
  const parsed = parseUrlLoose(url)
  if (reason === 'unparsable' || parsed == null) {
    throw new BilibiliApiError('blocked_host', '请求地址无法解析，已拒绝')
  }
  const host = parsed.hostname.toLowerCase()
  if (reason === 'host') {
    throw new BilibiliApiError('blocked_host', `请求主机不在 B 站域名白名单内，已拒绝（${host}）`)
  }
  throw new BilibiliApiError('blocked_host', `只允许 https 的 B 站点请求，已拒绝（${parsed.protocol}${host}）`)
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
    private readonly passportHost: string = DEFAULT_PASSPORT_HOST,
    /**
     * H1: 出站主机白名单。注入 localhost fake server 的测试传
     * `['http://127.0.0.1']`（scheme 显式写，见 BILIBILI_ALLOWED_HOSTS 注释）；
     * 不传 = 默认 B 站集合。
     */
    private readonly allowHosts: readonly string[] = BILIBILI_ALLOWED_HOSTS
  ) {}

  /** One JSON API call with the envelope code mapped onto the error taxonomy. */
  private async requestEnvelope(
    url: string,
    withCookie: boolean,
    options: { tolerateCodes?: number[]; referer?: string } = {}
  ): Promise<Envelope> {
    // H1 (audit 2026-09-28): 入口即校验——subtitle_url / playurl 这类来自响应体
    // 的 URL 不能带着 SESSDATA 出白名单；自己的 apiHost/passportHost 拼出来的
    // URL 天然在集合内，这一步对正常路径零成本。校验在读 cookie 之前，被拒时
    // 连凭据都不去取。
    assertAllowedBilibiliUrl(url, this.allowHosts)
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
    // H1: 封面 pic 同样来自 B 站响应体，入参先过白名单。与这个方法的既有语义
    // 一致——任何失败（网络/非图片/超限/主机不在白名单）都返回 null，预览回退
    // monogram 块，导入日志记 cover=fetched-failed。
    if (!isAllowedBilibiliUrl(url, this.allowHosts)) return null
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
   *
   * 批 A3-① (plan 2026-09-19): HTTP 412 风控重试阶梯。风控是 per-video 的
   * （dm-params.ts），dm_img 参数每次调用随机重建 + 新时间戳，所以**间隔重试
   * 拿到的就是新参数组合**；阶梯 = qn 32 → 32（间隔 2s）→ 16（降级，间隔 3s），
   * 仍 412 就如实把 risk_control 抛给调用方（合法无帧降级，不猜不缠）。
   */
  async dashStreams(bvid: string, cid: number, signal?: AbortSignal): Promise<BiliDashStreams> {
    const keys = await this.getWbiKeys()
    const ladder: Array<{ qn: string; delayMs: number }> = [
      { qn: '32', delayMs: 0 },
      { qn: '32', delayMs: 2000 },
      { qn: '16', delayMs: 3000 }
    ]
    for (const [i, step] of ladder.entries()) {
      if (signal?.aborted) throw new Error('任务已取消')
      if (step.delayMs > 0) await abortableSleep(step.delayMs, signal)
      const base = { bvid, cid: String(cid), qn: step.qn, fnval: '16', fourk: '0', try_look: '1' }
      const signed = signedPlayUrlParams(base, keys, buildDmImgParams(), Math.floor(Date.now() / 1000))
      const query = new URLSearchParams(signed).toString()
      try {
        const payload = await this.requestEnvelope(`${this.apiHost}/x/player/wbi/playurl?${query}`, true)
        const streams = parseDashStreams(payload)
        if (streams == null) throw new BilibiliApiError('bad_response', `bilibili playurl payload unusable for ${bvid}`)
        return streams
      } catch (err) {
        const kind = (err as BilibiliApiError).kind
        // 只有 412 值得重试；其余（网络/信封/负载）原样抛出，不mask真错误。
        if (kind !== 'risk_control' || i === ladder.length - 1) throw err
      }
    }
    /* 不可达：循环必抛或必返（防御性收尾，保持类型完整）。 */
    throw new BilibiliApiError('risk_control', `bilibili risk control (HTTP 412) for ${bvid}`)
  }

  /**
   * b23.tv short links answer with a redirect to the full /video/BV… URL.
   *
   * H1 (audit 2026-09-28): 这条通道在 ipc.ts 是把渲染层输入的 URL 原样交给
   * 这里——旧实现只做 `/b23.tv/` 子串匹配，`https://b23.tv.evil.com/x`、
   * `https://evil.com/b23.tv/x` 都能过，等于给任意主机开了一个带 UA/Referer 的
   * 盲请求口子。现在从输入里解析出 b23.tv 的短码、自己规范化成官方短链再请求，
   * 其它主机一律拒绝（SSRF 不带 cookie 也是 SSRF）。
   */
  async resolveShortLink(shortUrl: string): Promise<string> {
    const code = b23ShortCode(shortUrl)
    if (code === null) {
      throw new BilibiliApiError('blocked_host', '仅支持 b23.tv 短链，已拒绝其它地址')
    }
    const url = `https://b23.tv/${code}`
    const headers = { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com/' }
    let res
    let timer: NodeJS.Timeout | undefined
    try {
      res = await Promise.race([
        this.fetchImpl(url, { headers, redirect: 'manual' }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new BilibiliApiError('network', `bilibili short-link timeout for ${url}`)), this.timeoutMs)
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
    // 没有 Location 时返回我们请求的那个规范化短链本身——不读 res.url：manual
    // redirect 下它没有信息量，且 Electron net.fetch 的 Response.url 文档明示不正确。
    return url
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

/**
 * 从渲染层原样透传的输入里解析 b23.tv 短码：host 必须精确等于 b23.tv（子域、
 * 后缀拼接、路径里带 `b23.tv/` 都不算），短码 = 第一段非空路径。解析不出返回
 * null，调用方拒绝。scheme 不限也缺省容忍——我们总是自己规范化成 https 再请求，
 * 输入是什么协议无关紧要（用户粘贴的常是 http 或被聊天软件砍掉协议头的短链）；
 * 真正被请求的地址恒为 `https://b23.tv/<code>`，凭据/UA/Referer 只去官方主机。
 */
function b23ShortCode(input: string): string | null {
  const parsed = parseUrlLoose(input)
  if (parsed == null) return null
  if (parsed.hostname.toLowerCase() !== 'b23.tv') return null
  const code = parsed.pathname.split('/').find((segment) => segment !== '') ?? ''
  return code === '' ? null : code
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
