/**
 * 批3 item 5 (plan 2026-09-17 note-quality upgrade) 单测：长转写的全域抽稀。
 *
 * 起因：polish / qa 此前都是 `text.slice(0, 24000)`——45 分钟以上的课，后半段对
 * 模型**完全不存在**，于是「按反馈补细节」只能拿前半段的素材硬凑，追问后半段的
 * 内容也只能答「资料里没提」。改为逐行按步长抽稀，预算内覆盖整节课的首中尾。
 */
import { describe, expect, it } from 'vitest'
import { sampleTranscriptLines } from '../src/shared/notes/transcript-clean'
import { MAX_TRANSCRIPT_CHARS } from '../src/shared/notes/limits'

/** 造一份「每行都带时间锚、行数可控」的长转写。 */
function longLesson(lines: number, bodyChars: number): string {
  const body = '内容'.repeat(Math.ceil(bodyChars / 2))
  return Array.from({ length: lines }, (_, i) => `[${String(i).padStart(3, '0')}:00] ${body}${i}`).join('\n')
}

describe('sampleTranscriptLines 全域抽稀（批3 item 5）', () => {
  it('预算内原样返回（不做无意义的抽稀）', () => {
    const text = 'a\nb\nc'
    expect(sampleTranscriptLines(text, 100)).toBe(text)
  })

  it('超预算时覆盖整节课的首中尾，而不是只要开头', () => {
    const text = longLesson(200, 60)
    const sampled = sampleTranscriptLines(text, 2000)
    expect(sampled.length).toBeLessThanOrEqual(2000)
    expect(sampled.length).toBeLessThan(text.length)
    // 老实现 slice(0, N) 只能拿到开头；抽稀后末行必须在
    expect(sampled).toContain('[199:00]')
    expect(sampled).toContain('[000:00]')
    // 中间也要有（不只是在两端各取一行）
    expect(sampled.split('\n').length).toBeGreaterThan(5)
  })

  it('保留时间锚——抽稀后每行仍是可直接引用 [mm:ss] 的形态', () => {
    const sampled = sampleTranscriptLines(longLesson(200, 60), 1200)
    for (const line of sampled.split('\n')) expect(line.startsWith('[')).toBe(true)
  })

  it('确定性：同输入同输出（可回归，不随机抽）', () => {
    const text = longLesson(120, 40)
    expect(sampleTranscriptLines(text, 900)).toBe(sampleTranscriptLines(text, 900))
  })

  it('预算为 0 或负数 → 空串（不返回半截上下文）', () => {
    expect(sampleTranscriptLines('a\nb', 0)).toBe('')
    expect(sampleTranscriptLines('a\nb', -5)).toBe('')
  })

  it('已知取舍：单行本身就超预算时返回空串（不产出被砍掉一半的行）', () => {
    // 抽稀按**行**做，宁可没有上下文也不要半行——半行的时间锚与语义都是错的。
    // 真实转写里每行都是 30s 窗，远达不到 24k 字符，所以这是防御性边界而非常见路径。
    expect(sampleTranscriptLines('x'.repeat(500), 100)).toBe('')
  })

  it('CRLF 输入按行拆开（Windows 来源的转写不会变成一整行）', () => {
    const crlf = longLesson(50, 40).replace(/\n/g, '\r\n')
    const sampled = sampleTranscriptLines(crlf, 600)
    expect(sampled.split('\n').length).toBeGreaterThan(1)
    expect(sampled).not.toContain('\r')
  })
})

// P35 (plan 2026-09-21): 预算刻度单一事实源——生成/润色/追问三处共用同一个数值。
describe('MAX_TRANSCRIPT_CHARS（P35, shared/notes/limits）', () => {
  it('是 24k 且 sampleTranscriptLines 按它收敛（全域覆盖首中尾）', () => {
    expect(MAX_TRANSCRIPT_CHARS).toBe(24_000)
    const sampled = sampleTranscriptLines(longLesson(4000, 60), MAX_TRANSCRIPT_CHARS)
    expect(sampled.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS)
    const lines = sampled.split('\n')
    expect(lines.length).toBeGreaterThan(10)
    expect(lines[0]).toMatch(/^\[\d+:\d{2}\]/)
    expect(lines[lines.length - 1]).toMatch(/\[\d+:\d{2}\]/)
  })
})
