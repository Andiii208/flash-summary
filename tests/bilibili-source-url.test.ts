import { describe, expect, it } from 'vitest'
import { buildBilibiliSourceUrl, sanitizeJumpSeconds } from '../src/main/bilibili/source-url'

/**
 * 批 D (plan 2026-09-19-note-experience-overhaul): B 站原片跳转的 URL 拼装。
 *
 * 红线相关：URL 只能由 main 侧常量基准 + 库内 bvid 拼出——渲染层传的 `at` 是秒数
 * （数据），BV 号不合法时**返回 null**（调用方如实报错），绝不猜一个 URL 出去。
 */

describe('sanitizeJumpSeconds', () => {
  it('有限正数向下取整', () => {
    expect(sanitizeJumpSeconds(90)).toBe(90)
    expect(sanitizeJumpSeconds(90.9)).toBe(90)
  })

  it('负数/0/非数/非 number → 0', () => {
    expect(sanitizeJumpSeconds(-5)).toBe(0)
    expect(sanitizeJumpSeconds(0)).toBe(0)
    expect(sanitizeJumpSeconds(Number.NaN)).toBe(0)
    expect(sanitizeJumpSeconds(Number.POSITIVE_INFINITY)).toBe(0)
    expect(sanitizeJumpSeconds('90')).toBe(0)
    expect(sanitizeJumpSeconds(undefined)).toBe(0)
  })
})

describe('buildBilibiliSourceUrl（批 D）', () => {
  it('合法 BV + 秒数 → 常量基准 + ?t=', () => {
    expect(buildBilibiliSourceUrl('BV1tNpbekEht', 185)).toBe('https://www.bilibili.com/video/BV1tNpbekEht?t=185')
  })

  it('秒数净化：小数/怪值不原样进 URL', () => {
    expect(buildBilibiliSourceUrl('BV1tNpbekEht', 185.9)).toBe('https://www.bilibili.com/video/BV1tNpbekEht?t=185')
    expect(buildBilibiliSourceUrl('BV1tNpbekEht', -1)).toBe('https://www.bilibili.com/video/BV1tNpbekEht?t=0')
    // 渲染层若被注入怪值（字符串/对象），也不会拼进 URL。
    expect(buildBilibiliSourceUrl('BV1tNpbekEht', 'https://evil.example.com')).toBe('https://www.bilibili.com/video/BV1tNpbekEht?t=0')
  })

  it('多 P（page>1）带 p= 参数；page<=1/null 不带', () => {
    expect(buildBilibiliSourceUrl('BV1tNpbekEht', 60, 3)).toBe('https://www.bilibili.com/video/BV1tNpbekEht?t=60&p=3')
    expect(buildBilibiliSourceUrl('BV1tNpbekEht', 60, 1)).toBe('https://www.bilibili.com/video/BV1tNpbekEht?t=60')
    expect(buildBilibiliSourceUrl('BV1tNpbekEht', 60, null)).toBe('https://www.bilibili.com/video/BV1tNpbekEht?t=60')
  })

  it('BV 号不合法 → null（库内值被改坏也不漏）', () => {
    expect(buildBilibiliSourceUrl('not-a-bv', 60)).toBeNull()
    expect(buildBilibiliSourceUrl('BV123', 60)).toBeNull()
    expect(buildBilibiliSourceUrl('https://evil.example.com', 60)).toBeNull()
    expect(buildBilibiliSourceUrl('', 60)).toBeNull()
  })
})
