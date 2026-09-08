/**
 * 批1 (plan 2026-09-08 note-quality-overhaul) 钉住测试：SYSTEM_PROMPT /
 * POLISH_SYSTEM_PROMPT 的内容质量规约条款存在性。元纪律「设计声明与实现
 * 漂移」的防线——prompt 是行为契约，动条款必须动这里。
 */
import { describe, expect, it } from 'vitest'
import { NOTE_QUALITY_PROMPT, SYSTEM_PROMPT } from '../src/main/notes/summarize'
import { POLISH_SYSTEM_PROMPT } from '../src/main/notes/polish'

describe('SYSTEM_PROMPT 内容质量规约 (批1 2026-09-08)', () => {
  it('9.1 概念定义完整性下限 + 循环定义禁令', () => {
    expect(SYSTEM_PROMPT).toContain('不少于 60 字')
    expect(SYSTEM_PROMPT).toContain('是什么')
    expect(SYSTEM_PROMPT).toContain('为什么重要/用在哪/与什么区分')
    expect(SYSTEM_PROMPT).toContain('禁止循环定义')
  })

  it('9.2 时间线 detail 禁复读标题、refs 忠实摘引语义', () => {
    expect(SYSTEM_PROMPT).toContain('禁止复读 title')
    expect(SYSTEM_PROMPT).toContain('具体数字、参数、演示结果或结论')
    expect(SYSTEM_PROMPT).toContain('忠实摘引')
    expect(SYSTEM_PROMPT).toContain('不得改变数字、结论与因果')
  })

  it('9.3 overview 长度与结构下限', () => {
    expect(SYSTEM_PROMPT).toContain('不少于 150 字')
    expect(SYSTEM_PROMPT).toContain('合上时间线也能独立读懂')
  })

  it('9.4 考点具体性 + 宁空勿编', () => {
    expect(SYSTEM_PROMPT).toContain('考什么、怎么答')
    expect(SYSTEM_PROMPT).toContain('允许空数组，禁止为凑数编造')
  })

  it('9.5 缺口只写讲者真实留下的内容', () => {
    expect(SYSTEM_PROMPT).toContain('禁止编造思考题')
  })

  it('9.6 术语纠错条款（关键帧画面交叉验证）', () => {
    expect(SYSTEM_PROMPT).toContain('月华数据集')
    expect(SYSTEM_PROMPT).toContain('鸢尾花数据集')
    expect(SYSTEM_PROMPT).toContain('关键帧画面与上下文')
  })

  it('9.7 evidence few-shot 合法形态 + 仅关键帧素材时禁 ppt 引用 (1.3b 收口)', () => {
    expect(NOTE_QUALITY_PROMPT).toContain('"kind":"keyframe","ref":"kf:<证据ID>"')
    expect(SYSTEM_PROMPT).toContain('禁止输出任何 ppt: 引用')
  })

  it('9.8 conceptLinks label 关系词白名单（挂账「label 偏噪声」收口）', () => {
    expect(SYSTEM_PROMPT).toContain('前提、对比、易混、推广、步骤、因果、包含')
    expect(SYSTEM_PROMPT).toContain('禁止「参数、提升、方法」类名词填充')
  })

  it('形状规则钉住（批1 未破坏 2026-09-04 契约）', () => {
    expect(SYSTEM_PROMPT).toContain('整数秒')
    expect(SYSTEM_PROMPT).toContain('原样选用用户消息里给出的「证据ID」')
    expect(SYSTEM_PROMPT).toContain('5-8 题')
    expect(SYSTEM_PROMPT).toContain('不超过 20 字')
    // 旧规则 8 的 label 描述已迁往 9.8，形状段不得再保留旧措辞。
    expect(NOTE_QUALITY_PROMPT.startsWith('9)')).toBe(true)
  })
})

describe('POLISH_SYSTEM_PROMPT 质量同步 (批1 2026-09-08)', () => {
  it('含质量下限同步条款', () => {
    expect(POLISH_SYSTEM_PROMPT).toContain('质量下限同步')
    expect(POLISH_SYSTEM_PROMPT).toContain('禁止循环定义')
    expect(POLISH_SYSTEM_PROMPT).toContain('禁止复读 title')
    expect(POLISH_SYSTEM_PROMPT).toContain('正确术语写法')
  })

  it('保守修订纪律钉住（润色不许推倒重来）', () => {
    expect(POLISH_SYSTEM_PROMPT).toContain('不要推倒重来')
    expect(POLISH_SYSTEM_PROMPT).toContain('不要乱动')
    expect(POLISH_SYSTEM_PROMPT).toContain('保持原样')
  })
})
