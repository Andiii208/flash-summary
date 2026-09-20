import { describe, expect, it, vi } from 'vitest'
import { act } from 'preact/test-utils'
import { ProviderPanel } from '../../src/renderer/components/ProviderPanel'
import { mount, click, input } from '../helpers/preact'

/**
 * 批4 (plan 2026-09-20, P8/D4): 新用户引导断点。旧默认只勾 ASR 且模型留空，
 * 「一键保存」被静默拒绝（按钮 disabled、无任何原因），保存成功后管线仍不可用
 * ——spec §4 的首启推荐是「同一个 provider 同时支持 ASR 与多模态」。
 * 本文件钉住新的默认值与「为什么不能保存」的可见原因。
 */

function mountPanel(onSave = vi.fn()) {
  const host = mount(<ProviderPanel providers={null} busy={false} onSave={onSave} onRemove={() => undefined} />)
  return { host, onSave }
}

/** Preact listens for the native change event on <select> — set the value and
 *  fire it inside act so the controlled re-render flushes. */
function selectPreset(host: HTMLElement, label: string): void {
  act(() => {
    const select = host.querySelector<HTMLSelectElement>('select.qa-input')
    if (select == null) return
    select.value = label
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function capabilityBoxes(host: HTMLElement): HTMLInputElement[] {
  return [...host.querySelectorAll<HTMLInputElement>('.capability-check input[type="checkbox"]')]
}

function modelInput(host: HTMLElement, label: string): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
}

function saveButton(host: HTMLElement): HTMLButtonElement {
  return Array.from(host.querySelectorAll('button')).find((b) => b.textContent!.includes('保存并绑定')) as HTMLButtonElement
}

describe('ProviderPanel 首启默认值（批4 P8/D4）', () => {
  it('默认勾选 multimodal + asr——只勾 asr 的旧默认让保存成功后管线仍不可用', () => {
    const { host } = mountPanel()
    const boxes = capabilityBoxes(host)
    // P25 (2026-09-21): 能力面收敛为两项，「文本问答」不再是可绑定能力。
    expect(boxes).toHaveLength(2)
    // 顺序固定 asr / multimodal（CAPABILITY_ORDER）。
    expect(boxes.map((b) => b.checked)).toEqual([true, true])
    // 多模态模型跟着默认预设走，ASR 留空（OpenAI 预设不预填语音模型）。
    expect(modelInput(host, '多模态总结模型')!.value).toBe('gpt-4o')
    expect(modelInput(host, 'ASR 转写模型')!.value).toBe('')
  })

  // P25: 界面不再出现第三项的任何痕迹——复选框、图例、模型输入框三处都不该有。
  it('能力组只有 ASR 与多模态两项，界面不再出现「文本问答」', () => {
    const { host } = mountPanel()
    const labels = [...host.querySelectorAll('.capability-check')].map((el) => el.textContent ?? '')
    expect(labels).toEqual(['ASR 转写', '多模态总结'])
    expect(host.textContent).not.toContain('文本问答')
    // 图例也只剩两条，且多模态那条把「追问」并进自己的角色说明。
    const notes = [...host.querySelectorAll('.provider-cap-notes li')].map((el) => el.textContent ?? '')
    expect(notes).toHaveLength(2)
    expect(notes[1]).toContain('追问')
  })

  it('勾了 asr 却空模型：保存被挡，且输入框下有一行可见原因（不再静默）', () => {
    const { host } = mountPanel()
    const reason = (): string => host.querySelector('.capability-model-reason')?.textContent ?? ''
    expect(saveButton(host).disabled).toBe(true)
    expect(reason()).toContain('ASR 需要专门的语音模型')

    // 只勾 asr（取消多模态）也照样给原因，而不是把按钮留在无解释的 disabled。
    click(capabilityBoxes(host)[1])
    expect(capabilityBoxes(host)[1].checked).toBe(false)
    expect(reason()).toContain('ASR 需要专门的语音模型')
    expect(saveButton(host).disabled).toBe(true)

    input(modelInput(host, 'ASR 转写模型'), 'mimo-v2.5-asr')
    expect(host.querySelector('.capability-model-reason')).toBeNull()
    expect(saveButton(host).disabled).toBe(true) // 首个 provider 还缺 API Key
    input(host.querySelector('input[type="password"]'), 'sk-test')
    expect(saveButton(host).disabled).toBe(false)
  })

  it('ASR 提示文案只推荐小米 MiMo（whisper-1 不再出现在用户可见文案里）', () => {
    const { host } = mountPanel()
    const asr = modelInput(host, 'ASR 转写模型')!
    expect(asr.placeholder).toContain('mimo-v2.5-asr')
    expect(asr.placeholder).not.toContain('whisper-1')
    expect(host.textContent).not.toContain('whisper-1')
  })

  it('切小米 MiMo 预设回填 ASR 模型；切 OpenAI 不预填', () => {
    const { host } = mountPanel()
    selectPreset(host, '小米 MiMo')
    expect((host.querySelector('input[placeholder^="Base URL"]') as HTMLInputElement).value).toBe('https://api.xiaomimimo.com/v1')
    expect(modelInput(host, '多模态总结模型')!.value).toBe('mimo-v2.5')
    expect(modelInput(host, 'ASR 转写模型')!.value).toBe('mimo-v2.5-asr')

    // OpenAI 预设没有语音模型——不预填、也不把 whisper-1 猜进去。
    selectPreset(host, 'OpenAI')
    expect(modelInput(host, 'ASR 转写模型')!.value).not.toBe('whisper-1')
  })

  it('没有 asrModel 的预设：不动 asr，也不自动勾选', () => {
    const { host } = mountPanel()
    selectPreset(host, '小米 MiMo')
    click(capabilityBoxes(host)[0]) // 取消勾选 asr
    expect(capabilityBoxes(host)[0].checked).toBe(false)
    selectPreset(host, 'DeepSeek')
    expect(capabilityBoxes(host)[0].checked).toBe(false)
    // 模型字段跟着勾选态渲染——没勾就没有输入框，勾回来时值仍是 MiMo 那次留下的。
    click(capabilityBoxes(host)[0])
    expect(modelInput(host, 'ASR 转写模型')!.value).toBe('mimo-v2.5-asr')
  })
})
