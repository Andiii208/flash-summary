import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { ProvidersListResult } from '../../shared/bridge'
import { EmptyState } from './EmptyState'

const CAPABILITY_LABELS: Record<string, string> = { asr: 'ASR 转写', multimodal: '多模态总结', text: '文本问答' }

export interface ProviderPanelProps {
  providers: ProvidersListResult | null
  busy: boolean
  onSave: (input: { name: string; baseUrl: string; apiKey: string; capability: string; model: string }) => void
  onRemove: (id: string) => void
}

export function ProviderPanel({ providers, busy, onSave, onRemove }: ProviderPanelProps): JSX.Element {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [capability, setCapability] = useState('asr')
  const [model, setModel] = useState('')

  const submit = (): void => {
    if (name.trim() === '' || baseUrl.trim() === '' || model.trim() === '') return
    onSave({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey, capability, model: model.trim() })
    setApiKey('')
  }

  return (
    <section class="provider-panel">
      <h2>Provider 设置</h2>
      <div class="provider-form">
        <input class="qa-input" value={name} placeholder="名称（如 OpenAI）" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <input class="qa-input" value={baseUrl} placeholder="Base URL（https://api.openai.com/v1）" onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)} />
        <input class="qa-input" type="password" value={apiKey} placeholder="API Key（仅存内存，DPAPI 加密落库）" onInput={(e) => setApiKey((e.target as HTMLInputElement).value)} />
        <div class="provider-row">
          <select class="qa-input" value={capability} onChange={(e) => setCapability((e.target as HTMLSelectElement).value)}>
            {Object.entries(CAPABILITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input class="qa-input" value={model} placeholder="模型名（如 whisper-1 / gpt-4o）" onInput={(e) => setModel((e.target as HTMLInputElement).value)} />
        </div>
        <button class="btn primary" onClick={submit} disabled={busy}>
          {busy ? '保存中…' : '保存并绑定'}
        </button>
      </div>
      {providers == null || providers.providers.length === 0 ? (
        <EmptyState title="尚未配置 Provider" hint="添加 Provider 并绑定三种能力，任务管线才能运行。" />
      ) : (
        <div class="provider-list">
          {providers.providers.map((p) => {
            const bound = providers.bindings.filter((b) => b.providerId === p.id).map((b) => `${CAPABILITY_LABELS[b.capability] ?? b.capability}(${b.model})`)
            return (
              <div key={p.id} class="item provider-row">
                <span>
                  {p.name} — {bound.join('、') || '未绑定'}
                  {p.hasKey ? '' : ' 无Key'}
                </span>
                <button class="btn small" onClick={() => onRemove(p.id)}>
                  删除
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
