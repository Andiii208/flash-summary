import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatRelativeStamp, formatSpeed, formatStamp } from '../src/shared/format'
import { formatTime } from '../src/shared/notes/format'

describe('formatBytes / formatSpeed (M1-3)', () => {
  it('renders MB and GB with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(412 * 1024 * 1024)).toBe('412.0 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB')
  })

  it('renders speed in MB/s and falls back to KB/s', () => {
    expect(formatSpeed(2.1 * 1024 * 1024)).toBe('2.1 MB/s')
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s')
    expect(formatSpeed(0)).toBe('')
  })
})

describe('时间与时长口径（批7）', () => {
  it('formatTime 先取整再拆分——不再输出 01:60 / 00:60', () => {
    expect(formatTime(119.6)).toBe('02:00')
    expect(formatTime(59.6)).toBe('01:00')
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(65)).toBe('01:05')
    expect(formatTime(3599)).toBe('59:59')
    // 负数（异常输入）不产生负号。
    expect(formatTime(-3)).toBe('00:00')
  })

  it('formatDuration 用中文单位，分钟/小时各一档', () => {
    expect(formatDuration(45)).toBe('45 秒')
    expect(formatDuration(600)).toBe('10 分钟')
    expect(formatDuration(3600)).toBe('1 小时')
    expect(formatDuration(4320)).toBe('1 小时 12 分')
  })

  it('formatStamp 全应用一份：非法输入给「—」，而不是随实现分叉', () => {
    expect(formatStamp('not-a-date')).toBe('—')
    expect(formatStamp('2026-09-18T10:00:00+08:00')).toContain('2026')
    // 会话过期时间是 epoch ms，同一个函数要吃得下。
    expect(formatStamp(1_760_000_000_000)).toContain('2025')
  })

  it('formatRelativeStamp 一周内相对、更早回退完整时间戳', () => {
    const now = new Date('2026-09-18T12:00:00+08:00')
    expect(formatRelativeStamp('2026-09-18T11:59:30+08:00', now)).toBe('刚刚')
    expect(formatRelativeStamp('2026-09-18T11:30:00+08:00', now)).toBe('30 分钟前')
    expect(formatRelativeStamp('2026-09-18T09:00:00+08:00', now)).toBe('3 小时前')
    expect(formatRelativeStamp('2026-09-15T12:00:00+08:00', now)).toBe('3 天前')
    expect(formatRelativeStamp('2026-09-01T12:00:00+08:00', now)).toContain('2026')
    expect(formatRelativeStamp('bad', now)).toBe('—')
  })
})
