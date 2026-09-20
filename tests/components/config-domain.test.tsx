import { describe, expect, it, vi } from 'vitest'
import { act } from 'preact/test-utils'
import { useConfigDomain, type ConfigDomain, type Toast } from '../../src/renderer/hooks/use-config-domain'
import type { ProvidersListResult, SeuSummaryBridge } from '../../src/shared/bridge'
import { makeBridge, ok } from '../helpers/fake-app-bridge'
import { mount } from '../helpers/preact'

/**
 * 批4 (plan 2026-09-20): Provider 配置域。P8/D4 要求「保存成功 ≠ 管线可用」当场
 * 说清楚；P14 要求取消勾选的能力随保存真的解绑。
 */

let api: ConfigDomain | null = null

function Probe({ bridge, toast }: { bridge: SeuSummaryBridge; toast: Toast }): null {
  api = useConfigDomain(bridge, toast)
  return null
}

function mountDomain(listAfterSave?: ProvidersListResult): { bridge: SeuSummaryBridge; toast: ReturnType<typeof vi.fn> } {
  const bridge = makeBridge()
  // providers:list 是保存后回读的「真实状态」——mock 要能表达「这次绑定之后库里有什么」。
  if (listAfterSave != null) bridge.providers.list = vi.fn(async () => ok(listAfterSave))
  const toast = vi.fn()
  api = null
  mount(<Probe bridge={bridge} toast={toast} />)
  return { bridge, toast }
}

/** saveProvider is fire-and-return with an async body — flush it. */
async function save(input: Parameters<ConfigDomain['saveProvider']>[0]): Promise<void> {
  await act(async () => {
    api!.saveProvider(input)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const NEW_PROVIDER = { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' }

describe('useConfigDomain · Provider 保存（批4 P8/D4）', () => {
  it('保存后没有任何多模态绑定：当场指路，而不是等建任务才报错', async () => {
    const { bridge, toast } = mountDomain()
    await save({ ...NEW_PROVIDER, capabilities: ['text'], models: { text: 'gpt-4o' } })

    expect(bridge.providers.save).toHaveBeenCalledOnce()
    expect(bridge.providers.bind).toHaveBeenCalledWith('text', 'p', 'gpt-4o')
    expect(toast).toHaveBeenCalledWith('已保存。生成笔记还需要多模态总结模型——在上面勾选并绑定', 'info')
  })

  it('多模态已绑（本次勾选或别的 provider）：照常报绑定成功', async () => {
    const { toast } = mountDomain({
      providers: [{ id: 'p', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hasKey: true }],
      bindings: [{ capability: 'multimodal', providerId: 'p', model: 'gpt-4o' }]
    })
    await save({ ...NEW_PROVIDER, capabilities: ['multimodal'], models: { multimodal: 'gpt-4o' } })
    expect(toast).toHaveBeenCalledWith('已绑定 1 项能力 → OpenAI', 'success')
  })

  it('多模态绑在另一个 provider 上时不再误报「缺多模态」', async () => {
    const { toast } = mountDomain({
      providers: [{ id: 'p9', name: '旧', baseUrl: 'https://api.deepseek.com/v1', hasKey: true }],
      bindings: [{ capability: 'multimodal', providerId: 'p9', model: 'deepseek-chat' }]
    })
    await save({ ...NEW_PROVIDER, capabilities: ['text'], models: { text: 'gpt-4o' } })
    expect(toast).toHaveBeenCalledWith('已绑定 1 项能力 → OpenAI', 'success')
  })
})
