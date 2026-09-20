import { describe, expect, it } from 'vitest'
import { modelHasVision, visionCapabilityLabel } from '../src/shared/model-vision'

describe('modelHasVision（A1, plan 2026-09-19-note-experience-overhaul）', () => {
  it('已知无视觉模型 → false', () => {
    for (const model of ['deepseek-chat', 'deepseek-reasoner', 'Qwen/Qwen2.5-7B-Instruct']) {
      expect(modelHasVision(model)).toBe(false)
    }
  })

  it('已知有视觉模型与族前缀 → true（带日期/尺寸后缀也认）', () => {
    for (const model of ['gpt-4o', 'GPT-4o-mini', 'gpt-4.1-2025-04-14', 'claude-3-5-sonnet-20241022', 'gemini-1.5-flash', 'Qwen/Qwen2.5-VL-7B-Instruct', 'mimo-vl-7b']) {
      expect(modelHasVision(model)).toBe(true)
    }
  })

  it('表外型号 → null（未知 = 保守发图，现状逐字节不变）', () => {
    expect(modelHasVision('some-unknown-vlm-9')).toBeNull()
    expect(modelHasVision('')).toBeNull()
    expect(modelHasVision('  ')).toBeNull()
  })

  // 2026-09-20 订正：mimo-v2.5 经用户核实是多模态模型，上一版误列无视觉表（假说落表）。
  // 撤下后回到 null=未知=保守发图；mimo-vl 前缀仍判有视觉。
  it('mimo-v2.5 是多模态（订正后不再进无视觉表）：表外未知 → 保守发图', () => {
    expect(modelHasVision('MiMo-V2.5')).toBeNull()
    expect(modelHasVision('mimo-vl')).toBe(true)
  })

  it('徽标签名：无视觉 / 视觉 / 视觉能力未知', () => {
    expect(visionCapabilityLabel('deepseek-chat')).toBe('无视觉')
    expect(visionCapabilityLabel('gpt-4o')).toBe('视觉')
    expect(visionCapabilityLabel('mimo-v2.5')).toBe('视觉能力未知')
    expect(visionCapabilityLabel('whatever-x')).toBe('视觉能力未知')
  })
})
