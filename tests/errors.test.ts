import { describe, expect, it } from 'vitest'
import { humanizeTaskError } from '../src/shared/errors'

describe('humanizeTaskError (M1-2: errors speak human)', () => {
  it('translates well-known network codes to guidance, keeping kind priority', () => {
    expect(humanizeTaskError('下载视频失败: process failed: ERR_CONNECTION_RESET', null)).toContain('网络连接被中断')
    expect(humanizeTaskError('ERR_NAME_NOT_RESOLVED', null)).toContain('DOMAIN-SUFFIX')
    expect(humanizeTaskError('ETIMEDOUT', null)).toContain('超时')
  })

  it('kind wins: cancelled and session_expired get dedicated copy', () => {
    expect(humanizeTaskError('download failed: whatever', 'cancelled')).toBe('已取消')
    expect(humanizeTaskError('school session expired (HTTP 401)', 'session_expired')).toContain('重新登录')
  })

  it('passes already-readable provider messages through untouched', () => {
    expect(humanizeTaskError('未绑定 ASR 模型，请在设置中配置 ASR Provider', null)).toContain('未绑定')
    expect(humanizeTaskError('该课时音频中没有可识别的语音（音量过低或静音），无法转写', null)).toContain('静音')
    expect(humanizeTaskError(null, null)).toBe('未知错误')
  })
})

describe('ffmpeg banner garbage maps to human copy (F4)', () => {
  it('the raw remux failure the user screenshotted becomes guidance', () => {
    const raw = '下载视频失败: process failed: ffmpeg version 6.1.1-essentials_build-www.gyan.dev Copyright (c) ...'
    expect(humanizeTaskError(raw, null)).toContain('视频处理中断')
    expect(humanizeTaskError(raw, null)).not.toContain('ffmpeg version')
  })
})
