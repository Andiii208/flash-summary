/**
 * H2 (audit 2026-09-28): 主进程 HTTP 的会话感知 fetch。
 *
 * 为什么需要它：index.ts 只给 Chromium session 设了 system 代理
 * （`session.defaultSession.setProxy`，带 PROXY_BYPASS_RULES 校园直连豁免），
 * 而 Chromium 的代理配置对 Node/undici 的 globalThis.fetch 完全不可见——Clash
 * 混合端口（非 TUN）用户于是「窗口内网页正常、main 侧请求全直连失败」，表现为
 * 界面能开、任务全挂。Electron 的 `net.fetch` 走 Chromium 网络栈、天然复用同
 * 一份代理与会话配置，所以主进程的默认 fetch 应该用它。
 *
 * 三条边界都写在这里而不是散在调用方（不猜，逐条有据）：
 *
 * 1. `redirect: 'manual'` 的请求退回 globalThis.fetch。net.fetch 不支持
 *    manual redirect——服务端 3xx 时它直接抛 «Redirect was cancelled»
 *    （electron#43715，30/32 实测、2026-03 关为 not planned），而短链解析、QR
 *    登录确认、CAS 跳转识别都必须读到 3xx 本身（Location 头）。这些调用方也不
 *    该被 follow：跟随重定向会把带 cookie 的请求送到 Location 指定的主机，正是
 *    批1 白名单要堵的口子。
 *    **后果（如实记账）**：school/bilibili 的 API 请求全带 manual，所以它们留
 *    在 globalThis.fetch 上、不走 session 代理；session 感知覆盖的是 provider
 *    HTTP（ASR/总结）与登录探活。「先用 net.fetch 试、失败再补一发 undici」看
 *    似能全覆盖，但 QR confirm 是**一次性**响应（第二次轮询只会回 86038
 *    expired），重发会把登录确认吃掉——所以不能重试，manual 必须一次到位。
 *    要覆盖 school/bilibili，得等 Electron 支持 manual redirect，或改走
 *    session.resolveProxy + undici ProxyAgent（plan D4 已否决那条路）。
 * 2. electron mock（测试）或旧运行时没有 net.fetch 时退回 globalThis.fetch，
 *    行为与改造前完全一致。
 * 3. net.fetch 对 AbortSignal 的兑现不如 undici 可靠，而多个调用方拿
 *    AbortSignal.timeout 当唯一硬超时（登录窗 precheck、session 探活）——
 *    被忽略的信号就是永久挂起。所以这里补一道 race：底层请求可能还在飞，但
 *    调用方按时序拿到失败（school client 的 Promise.race 当初就是这么活下来的）。
 */
import { net } from 'electron'

/** Electron net.fetch 的调用签名（主进程内与标准 RequestInit 兼容）。 */
type NetFetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 取 Electron 的 net.fetch；取不到返回 null。
 *
 * try/catch 不是防御性滥写：vitest 的 `vi.mock('electron', …)` 会把模块包一层
 * 代理，访问 mock 没提供的导出时抛错（而不是给 undefined）——那正是「测试里
 * electron 桩没有 net」的常态，必须当「取不到」处理而不是 crash。
 */
function electronNetFetch(): NetFetchLike | null {
  try {
    const candidate: unknown = net?.fetch
    return typeof candidate === 'function' ? (candidate as NetFetchLike) : null
  } catch {
    return null
  }
}

/** AbortSignal 的 reason 原样传播（Node 18+ 标准字段），缺省时兜一个 Error。 */
function abortError(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error('fetch aborted (signal)')
}

/** 把 AbortSignal 的 abort 兑现成 reject——补上 net.fetch 不保证的那一半。 */
function raceAbort(pending: Promise<Response>, signal: AbortSignal): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(
      (res) => {
        signal.removeEventListener('abort', onAbort)
        resolve(res)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

/**
 * net.fetch 构造 Response 时不带 url（源码：`new Response(body, { headers,
 * status, statusText })`），库里 res.url 恒为空串——Electron 文档也因此明示
 * 「Response.url 不正确」。而 undici 的 res.url：manual redirect 下等于请求
 * url、follow 下等于最终 url。把它钉回请求 url：manual 退路（school client
 * 的 CAS 落页判定走这条）与改造前逐字节一致；net.fetch 路径上读 url 的调用方
 * 至少拿到真实请求地址而不是空串。
 */
function pinResponseUrl(res: Response, url: string): Response {
  if (res.url === url) return res
  try {
    Object.defineProperty(res, 'url', { value: url, configurable: true })
  } catch {
    // 只读对象：当前唯一读者（school client）走 manual 退路，到不了这里。
  }
  return res
}

/**
 * 会话感知 fetch：能用 net.fetch 就走 Chromium 网络栈（代理/会话配置全复用），
 * 否则退回 globalThis.fetch。签名与标准 fetch 一致，可直接当 SchoolClient /
 * BilibiliClient / OpenAiCompatibleClient 的默认 fetchImpl 注入。
 */
export async function sessionAwareFetch(url: string, init?: RequestInit): Promise<Response> {
  const netFetch = init?.redirect === 'manual' ? null : electronNetFetch()
  if (netFetch == null) {
    // 边界 1/2：manual redirect 或取不到 net.fetch → undici（改造前行为）。
    return pinResponseUrl(await globalThis.fetch(url, init), url)
  }
  if (init?.signal?.aborted === true) {
    // 已经取消的请求不再发出去——net.fetch 不保证兑现信号，别浪费一次往返。
    throw abortError(init.signal)
  }
  const pending = netFetch(url, init)
  const signal = init?.signal
  if (signal == null) return pinResponseUrl(await pending, url)
  // 边界 3：信号兑现补一道 race，别让被忽略的 AbortSignal 变成永久挂起。
  return pinResponseUrl(await raceAbort(pending, signal), url)
}
