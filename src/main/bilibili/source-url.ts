/**
 * 批 D (plan 2026-09-19-note-experience-overhaul): B 站原片时间戳跳转。
 *
 * 历史边界订正：note-craft SKILL §12 与 PROGRESS「明确不做」清单② 把「时间戳跳转
 * 视频」列为硬约束——那条写于只考虑 SEU 源的年代（平台播放页没有时间参数，本地
 * 视频又有借无还）。B 站公开支持 `?t=<秒>`，故按源收窄：**仅 SEU 源不做，B 站做**。
 *
 * 红线（AGENTS）：打开外部网址只能经 main 侧固定常量。渲染层只传 lessonId 与秒数
 * （数据，不是 URL）；URL 由本模块用**常量基准** + 库内 bvid 拼出。bvid 导入时已过
 * `/^BV[0-9A-Za-z]{10}$/`，这里再做一次才拼（纵深防御，库内值被改坏也不漏）。
 */

const BILIBILI_VIDEO_BASE = 'https://www.bilibili.com/video/'

/** 与 bilibili/url-parse.ts 同一把尺子（BV 号形态）。 */
const BV_PATTERN = /^BV[0-9A-Za-z]{10}$/

/**
 * 库内 BV 号形态校验（唯一一把尺子）：拼外链与向 B 站请求都要先过它。
 * 批3 (P1): 封面回填从库内取 bvid 再发请求——库内值被改坏时拒绝，不外发。
 */
export function isValidBilibiliBvid(bvid: unknown): bvid is string {
  return typeof bvid === 'string' && BV_PATTERN.test(bvid)
}

/** 秒数净化：非有限值/负数 → 0；小数向下取整。渲染层传的是帧/条目 at，不该有怪值，但不信。 */
export function sanitizeJumpSeconds(at: unknown): number {
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return 0
  return Math.floor(at)
}

/**
 * 拼 B 站原片跳转 URL；bvid 不合法返回 null（调用方如实报错，不猜一个 URL 出去）。
 * `page` 是多 P 视频的分 P 序号（1-based，lessons.bili_page）——>1 时才带 `p=` 参数。
 */
export function buildBilibiliSourceUrl(bvid: string, at: unknown, page?: number | null): string | null {
  if (!isValidBilibiliBvid(bvid)) return null
  const seconds = sanitizeJumpSeconds(at)
  const params = [`t=${seconds}`]
  if (typeof page === 'number' && Number.isInteger(page) && page > 1) params.push(`p=${page}`)
  return `${BILIBILI_VIDEO_BASE}${bvid}?${params.join('&')}`
}
