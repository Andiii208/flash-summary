/**
 * Human-facing error mapping (M1-2): raw transport errors (ERR_* codes,
 * provider messages) read as engineer-speak. This maps the common field
 * cases to 场景 + 下一步动作; the original text always stays available in
 * tooltips and the file log.
 */

/** Well-known Windows/Chromium network error codes → user guidance. */
const NETWORK_CODE_MAP: Array<[RegExp, string]> = [
  [/ERR_CONNECTION_(CLOSED|RESET)/, '网络连接被中断——请检查校园网是否可达，以及代理是否放行了 *.seu.edu.cn 直连'],
  [/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/, '网络不可用或刚切换——请检查网络后重试'],
  [/ERR_NAME_NOT_RESOLVED/, '域名解析失败——若使用 Clash 等 TUN 代理，请添加 DOMAIN-SUFFIX,seu.edu.cn,DIRECT 规则'],
  [/ERR_TIMED_OUT|ETIMEDOUT|timeout/i, '连接超时——校园网可能较慢或服务暂不可用，稍后重试'],
  [/ERR_CERT|SSL/, '安全证书校验失败——请确认未对该域名做中间人代理'],
  [/ECONNREFUSED|ECONNRESET|EPIPE/, '连接被对端断开——多为校园网/代理拦截，请检查网络后重试']
]

/**
 * Map a task error to user-facing text. kind takes priority (cancelled /
 * session_expired have dedicated copy); otherwise the well-known network
 * codes are translated; anything else passes through unchanged (provider
 * messages are often already readable).
 */
export function humanizeTaskError(message: string | null | undefined, kind?: string | null): string {
  if (message == null || message === '') return '未知错误'
  if (kind === 'cancelled' || message.includes('任务已取消')) return '已取消'
  if (kind === 'session_expired' || message.includes('session expired')) return '登录已过期——请重新登录后重试'
  for (const [pattern, guidance] of NETWORK_CODE_MAP) {
    if (pattern.test(message)) return guidance
  }
  if (message.includes('未绑定')) return message
  if (message.includes('无音频') || message.includes('静音')) return message
  if (message.includes('play-page') || message.includes('播放页')) return message
  return message
}
