import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { ProvidersListResult } from '../../shared/bridge'
import { EmptyState } from './EmptyState'
import { Dialog } from '../ui/Dialog'

const CAPABILITY_LABELS: Record<string, string> = { asr: 'ASR 转写', multimodal: '多模态总结', text: '文本问答' }

/** M3 批 D: 常见 Provider 预设——选一个自动填三件套，仍可手改。 */
const PROVIDER_PRESETS: Array<{ label: string; name: string; baseUrl: string; model: string }> = [
  { label: 'OpenAI', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { label: 'DeepSeek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '硅基流动', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { label: '小米 MiMo', name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5' },
  { label: '自定义…', name: '', baseUrl: '', model: '' }
]

export interface ProviderPanelProps {
  providers: ProvidersListResult | null
  busy: boolean
  onSave: (input: { name: string; baseUrl: string; apiKey: string; capability: string; model: string }) => void
  onRemove: (id: string) => void
  /** M3 批 D: probe the form values against the real endpoint. */
  onTest?: (input: { baseUrl: string; apiKey: string; model: string }) => void
  /** M3 批 D: result of the last probe (parent owns the async state). */
  testResult?: { ok: boolean; text: string } | null
}

export function ProviderPanel({ providers, busy, onSave, onRemove, onTest, testResult }: ProviderPanelProps): JSX.Element {
  const [preset, setPreset] = useState(PROVIDER_PRESETS[0]!.label)
  const [name, setName] = useState(PROVIDER_PRESETS[0]!.name)
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0]!.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [capability, setCapability] = useState('asr')
  const [model, setModel] = useState(PROVIDER_PRESETS[0]!.model)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)

  const applyPreset = (label: string): void => {
    setPreset(label)
    const hit = PROVIDER_PRESETS.find((p) => p.label === label)
    if (hit != null) {
      setName(hit.name)
      setBaseUrl(hit.baseUrl)
      setModel(hit.model)
    }
  }

  const submit = (): void => {
    if (name.trim() === '' || baseUrl.trim() === '' || model.trim() === '') return
    onSave({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey, capability, model: model.trim() })
    setApiKey('')
  }

  const canTest = baseUrl.trim() !== '' && model.trim() !== ''

  return (
    <section class="provider-panel">
      <h2>Provider 设置</h2>
      <div class="provider-form">
        <select
          class="qa-input"
          value={preset}
          onChange={(e) => applyPreset((e.target as HTMLSelectElement).value)}
          aria-label="Provider 预设"
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
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
        {capability === 'asr' && (
          <p class="provider-hint">ASR 模型通常是专门的语音模型（如 whisper-1 / mimo-v2.5-asr），与对话模型不同。</p>
        )}
        <div class="provider-actions">
          <button class="btn primary" onClick={submit} disabled={busy}>
            {busy ? '保存中…' : '保存并绑定'}
          </button>
          {onTest != null && (
            <button class="btn" onClick={() => onTest({ baseUrl: baseUrl.trim(), apiKey, model: model.trim() })} disabled={!canTest || busy}>
              测试连接
            </button>
          )}
        </div>
        {testResult != null && (
          <p class={`provider-test ${testResult.ok ? 'ok' : 'fail'}`} role="status">
            {testResult.text}
          </p>
        )}
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
                <button class="btn small danger" onClick={() => setPendingDelete({ id: p.id, name: p.name })}>
                  删除
                </button>
              </div>
            )
          })}
        </div>
      )}
      <Dialog
        open={pendingDelete != null}
        title={`删除 Provider「${pendingDelete?.name ?? ''}」？`}
        message="删除后需重新录入 API Key 并重新绑定能力。已生成的笔记不受影响。"
        confirmLabel="删除"
        danger
        onConfirm={() => {
          if (pendingDelete != null) onRemove(pendingDelete.id)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}
