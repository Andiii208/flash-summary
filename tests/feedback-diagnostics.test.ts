import { describe, expect, it } from 'vitest'
import { buildDiagnostics, type DiagnosticsTask } from '../src/main/feedback/diagnostics'
import { redact } from '../src/main/logger'

/**
 * 声明批6（plan 2026-09-11 compliance-disclosure）: 反馈诊断文本。
 *
 * 这段文本的特殊之处：它不是躺在日志里，而是**用户会主动复制并粘贴到外部表单**。
 * 所以脱敏漏一次的后果比日志泄漏更严重。这里既测字段齐全，也测凭据进不去。
 */

const TASK: DiagnosticsTask = {
  id: 't-1',
  state: 'failed',
  failed_stage: 'downloading_video',
  error_message: '拉流失败：连接被重置',
  error_kind: null,
  created_at: '2026-09-11T10:00:00.000Z',
  updated_at: '2026-09-11T10:02:00.000Z',
  lesson_title: '第3讲 傅里叶级数',
  course_name: '信号与系统',
  source: 'seu'
}

const BASE = {
  version: '9.9.9',
  platform: 'win32 x64',
  logsDir: 'C:\\Users\\x\\AppData\\Roaming\\seu-summary\\logs'
}

describe('反馈诊断文本（声明批6）', () => {
  it('带齐定位问题所需的字段：版本 / 平台 / 课程课时 / 失败阶段与原因', () => {
    const text = buildDiagnostics({ ...BASE, task: TASK })
    expect(text).toContain('应用版本：9.9.9')
    expect(text).toContain('win32 x64')
    expect(text).toContain('信号与系统')
    expect(text).toContain('第3讲 傅里叶级数')
    expect(text).toContain('downloading_video')
    expect(text).toContain('拉流失败：连接被重置')
    // 视频源要说人话，用户在反馈里说不清是校内课还是 B 站。
    expect(text).toContain('东南大学云课堂')
    // 日志目录随行——没有它，开发者只能靠猜。
    expect(text).toContain('logs')
  })

  it('缺失字段省略而不是印出 null / undefined', () => {
    const text = buildDiagnostics({ ...BASE, task: { ...TASK, course_name: null, error_kind: null, created_at: null } })
    expect(text).not.toContain('null')
    expect(text).not.toContain('undefined')
    // 仍是可读的一段，而不是塌成几行。
    expect(text).toContain('任务 ID：t-1')
  })

  it('任务已删除时不崩，而是如实说明', () => {
    const text = buildDiagnostics({ ...BASE, task: null })
    expect(text).toContain('未找到该任务')
  })

  it('B 站源显示为 B站，不泄露内部标识', () => {
    const text = buildDiagnostics({ ...BASE, task: { ...TASK, source: 'bilibili' } })
    expect(text).toContain('B站')
  })

  it('凭据进不了这段文本（redact 兜底这道是必须的）', () => {
    // 模拟一条「脏」的失败原因：真实链路里入库时已经脱敏过一次，但这段文本会被
    // 用户复制到外部表单，所以 ipc handler 还会再过一遍 redact()。
    const dirty = buildDiagnostics({
      ...BASE,
      task: { ...TASK, error_message: 'GET https://dncvsvod.seu.edu.cn/x.mp4?auth_key=SECRET123 失败 cookie=SESSDATA%3Dabc api_key=sk-live-1' }
    })
    // 未脱敏的原文确实带着密钥——证明这个测试有意义（不是在测空气）。
    expect(dirty).toContain('SECRET123')

    const safe = redact(dirty)
    expect(safe).not.toContain('SECRET123')
    expect(safe).not.toContain('sk-live-1')
  })
})
