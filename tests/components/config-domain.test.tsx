import { describe, expect, it, vi } from 'vitest'
import { useEffect } from 'preact/hooks'
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

/** App 外壳在挂载时就会拉一次 providers——这里照抄同一条加载路径，否则
 *  「原有绑定」永远是空的，解绑用例会假装通过。 */
function Probe({ bridge, toast }: { bridge: SeuSummaryBridge; toast: Toast }): null {
  const domain = useConfigDomain(bridge, toast)
  api = domain
  useEffect(() => {
    void domain.refreshProviders()
  }, [domain.refreshProviders])
  return null
}

async function mountDomain(listAfterSave?: ProvidersListResult): Promise<{ bridge: SeuSummaryBridge; toast: ReturnType<typeof vi.fn> }> {
  const bridge = makeBridge()
  // providers:list 是保存后回读的「真实状态」——mock 要能表达「这次绑定之后库里有什么」。
  if (listAfterSave != null) bridge.providers.list = vi.fn(async () => ok(listAfterSave))
  // 真 main 的 providers:save 会沿用传入的 id（编辑不换行）——夹具必须同款，
  // 否则编辑路径拿到的 providerId 对不上原有绑定，解绑会被静默跳过。
  bridge.providers.save = vi.fn(async (input: { id?: string }) => ok({ id: input.id ?? 'p', hasKey: true }))
  const toast = vi.fn()
  api = null
  mount(<Probe bridge={bridge} toast={toast} />)
  // Preact 的重渲染排在 act 之外的一拍——必须等到「挂载时那次加载」真的落地，
  // 否则用例读到的是 providers=null，解绑分支会被静默跳过（假绿）。
  await vi.waitFor(() => {
    expect(api?.providers).not.toBeNull()
  }, { timeout: 2000 })
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
    const { bridge, toast } = await mountDomain()
    await save({ ...NEW_PROVIDER, capabilities: ['asr'], models: { asr: 'mimo-v2.5-asr' } })

    expect(bridge.providers.save).toHaveBeenCalledOnce()
    expect(bridge.providers.bind).toHaveBeenCalledWith('asr', 'p', 'mimo-v2.5-asr')
    expect(toast).toHaveBeenCalledWith('已保存。生成笔记还需要多模态总结模型——在上面勾选并绑定', 'info')
  })

  it('多模态已绑（本次勾选或别的 provider）：照常报绑定成功', async () => {
    const { toast } = await mountDomain({
      providers: [{ id: 'p', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hasKey: true }],
      bindings: [{ capability: 'multimodal', providerId: 'p', model: 'gpt-4o' }]
    })
    await save({ ...NEW_PROVIDER, capabilities: ['multimodal'], models: { multimodal: 'gpt-4o' } })
    expect(toast).toHaveBeenCalledWith('已绑定 1 项能力 → OpenAI', 'success')
  })

  it('多模态绑在另一个 provider 上时不再误报「缺多模态」', async () => {
    const { toast } = await mountDomain({
      providers: [{ id: 'p9', name: '旧', baseUrl: 'https://api.deepseek.com/v1', hasKey: true }],
      bindings: [{ capability: 'multimodal', providerId: 'p9', model: 'deepseek-chat' }]
    })
    await save({ ...NEW_PROVIDER, capabilities: ['asr'], models: { asr: 'mimo-v2.5-asr' } })
    expect(toast).toHaveBeenCalledWith('已绑定 1 项能力 → OpenAI', 'success')
  })
})

describe('useConfigDomain · 取消勾选即解绑（批4 P14）', () => {
  it('编辑时取消勾选的能力随保存 unbind，勾选的仍 bind', async () => {
    const { bridge, toast } = await mountDomain({
      providers: [{ id: 'p1', name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', hasKey: true }],
      bindings: [
        { capability: 'asr', providerId: 'p1', model: 'mimo-v2.5-asr' },
        { capability: 'multimodal', providerId: 'p1', model: 'mimo-v2.5' }
      ]
    })
    // 用户取消勾选 asr、保留 multimodal（表单只把勾选的交给 onSave）。
    await save({ id: 'p1', name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: '', capabilities: ['multimodal'], models: { multimodal: 'mimo-v2.5' } })

    expect(bridge.providers.unbind).toHaveBeenCalledTimes(1)
    expect(bridge.providers.unbind).toHaveBeenCalledWith('asr')
    expect(bridge.providers.bind).toHaveBeenCalledWith('multimodal', 'p1', 'mimo-v2.5')
    expect(toast).toHaveBeenCalledWith('已绑定 1 项能力，解绑 1 项能力 → MiMo', 'success')
  })

  it('别的 provider 的绑定不受影响——只解绑本 provider 原有、本次未勾选的能力', async () => {
    const { bridge } = await mountDomain({
      providers: [
        { id: 'p1', name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', hasKey: true },
        { id: 'p2', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hasKey: true }
      ],
      bindings: [
        { capability: 'multimodal', providerId: 'p1', model: 'mimo-v2.5' },
        { capability: 'asr', providerId: 'p2', model: 'mimo-v2.5-asr' }
      ]
    })
    await save({ id: 'p1', name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: '', capabilities: ['asr'], models: { asr: 'mimo-v2.5-asr' } })

    expect(bridge.providers.unbind).toHaveBeenCalledTimes(1)
    expect(bridge.providers.unbind).toHaveBeenCalledWith('multimodal')
    expect(bridge.providers.bind).toHaveBeenCalledWith('asr', 'p1', 'mimo-v2.5-asr')
  })

  it('新建 provider 没有原有绑定：不调 unbind', async () => {
    const { bridge } = await mountDomain()
    await save({ ...NEW_PROVIDER, capabilities: ['multimodal'], models: { multimodal: 'gpt-4o' } })
    expect(bridge.providers.unbind).not.toHaveBeenCalled()
  })

  it('解绑失败：报错并刷新列表，不再谎报「已解绑」', async () => {
    const { bridge, toast } = await mountDomain({
      providers: [{ id: 'p1', name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', hasKey: true }],
      bindings: [{ capability: 'asr', providerId: 'p1', model: 'mimo-v2.5-asr' }]
    })
    bridge.providers.unbind = vi.fn(async () => ({ ok: false, error: '数据库忙' }))
    await save({ id: 'p1', name: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: '', capabilities: ['multimodal'], models: { multimodal: 'mimo-v2.5' } })

    expect(toast).toHaveBeenCalledWith('Provider 已保存，但能力 asr 解绑失败：数据库忙', 'error')
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining('已绑定 1 项能力'), 'success')
    expect(bridge.providers.list).toHaveBeenCalledTimes(2) // 刷新列表让界面说出真实状态
  })
})
