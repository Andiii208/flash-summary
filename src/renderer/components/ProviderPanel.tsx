import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { ProvidersListResult } from '../../shared/bridge'
import { EmptyState } from './EmptyState'
import { Dialog } from '../ui/Dialog'

const CAPABILITY_LABELS: Record<string, string> = { asr: 'ASR 转写', multimodal: '多模态总结', text: '文本问答' }
const CAPABILITY_ORDER: ReadonlyArray<string> = ['asr', 'multimodal', 'text']

/** 2026-09-05 批4: the three capabilities explained against the pipeline —
 *  the terms no longer appear bare in the form. */
const CAPABILITY_NOTES: ReadonlyArray<{ id: string; role: string }> = [
  { id: 'asr', role: '把课程录音转成文字（任务·转写阶段）' },
  { id: 'multimodal', role: '看课件截图与转写生成五视图笔记（任务·总结阶段）' },
  { id: 'text', role: '在「追问」页回答提问' }
]

/** M3 批 D: 常见 Provider 预设——选一个自动填三件套，仍可手改。 */
const PROVIDER_PRESETS: Array<{ label: string; name: string; baseUrl: string; model: string }> = [
  { label: 'OpenAI', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { label: 'DeepSeek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '硅基流动', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { label: '小米 MiMo', name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5' },
  { label: '自定义…', name: '', baseUrl: '', model: '' }
]

const ASR_MODEL_HINT = 'ASR 需要专门的语音模型，如 whisper-1 / mimo-v2.5-asr'
const CHAT_MODEL_HINT = '如 gpt-4o / deepseek-chat'

/** One save: the provider identity plus a model PER bound capability. */
export interface ProviderSaveInput {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  capabilities: string[]
  models: Record<string, string>
}

export interface ProviderPanelProps {
  providers: ProvidersListResult | null
  busy: boolean
  onSave: (input: ProviderSaveInput) => void
  onRemove: (id: string) => void
  /** M3 批 D: probe the form values against the real endpoint. */
  onTest?: (input: { baseUrl: string; apiKey: string; model: string }) => void
  /** M3 批 D: result of the last probe (parent owns the async state). */
  testResult?: { ok: boolean; text: string } | null
  /** 批6: the probe is in flight — the test button disables (no double fire). */
  testBusy?: boolean
}

/** Fixed capability legend at the top of the block. */
function CapabilityNotes(): JSX.Element {
  return (
    <ul class="provider-cap-notes">
      {CAPABILITY_NOTES.map((n) => (
        <li key={n.id}>
          <b>{CAPABILITY_LABELS[n.id]}</b> — {n.role}
        </li>
      ))}
    </ul>
  )
}

interface ProviderRowProps {
  provider: ProvidersListResult['providers'][number]
  bindings: ProvidersListResult['bindings']
  onEdit: (id: string) => void
  onDelete: (p: { id: string; name: string }) => void
}

/** One configured provider: identity, base URL, per-capability bindings. */
function ProviderRowView({ provider, bindings, onEdit, onDelete }: ProviderRowProps): JSX.Element {
  const bound = bindings.filter((b) => b.providerId === provider.id)
  return (
    <div class="item provider-row">
      <div class="provider-row-main">
        <span class="provider-row-name">
          {provider.name}
          {provider.hasKey ? null : <span class="badge warn">无 Key</span>}
        </span>
        <code class="provider-row-url" title={provider.baseUrl}>
          {provider.baseUrl}
        </code>
        <span class="provider-row-bindings">
          {bound.length === 0
            ? '未绑定能力'
            : bound.map((b) => (
                <span key={b.capability} class="badge" title={`${CAPABILITY_LABELS[b.capability] ?? b.capability} 绑定的模型`}>
                  {CAPABILITY_LABELS[b.capability] ?? b.capability}: {b.model}
                </span>
              ))}
        </span>
      </div>
      <button class="btn small" onClick={() => onEdit(provider.id)}>
        编辑
      </button>
      <button class="btn small danger" onClick={() => onDelete({ id: provider.id, name: provider.name })}>
        删除
      </button>
    </div>
  )
}

interface ProviderFormProps {
  preset: string
  editing: boolean
  name: string
  baseUrl: string
  apiKey: string
  capabilities: ReadonlySet<string>
  models: Record<string, string>
  busy: boolean
  canSave: boolean
  canTest: boolean
  testResult?: { ok: boolean; text: string } | null
  onPreset: (label: string) => void
  onName: (v: string) => void
  onBaseUrl: (v: string) => void
  onApiKey: (v: string) => void
  onToggleCapability: (id: string) => void
  onModel: (id: string, v: string) => void
  onSubmit: () => void
  onTest: () => void
  /** 批6: probe in flight — disables the test button. */
  testBusy?: boolean
}

/** The add/edit form — collapsed under <details> once a provider exists. */
function ProviderForm(p: ProviderFormProps): JSX.Element {
  return (
    <div class="provider-form">
      <select class="qa-input" value={p.preset} onChange={(e) => p.onPreset((e.target as HTMLSelectElement).value)} aria-label="Provider 预设">
        {PROVIDER_PRESETS.map((preset) => (
          <option key={preset.label} value={preset.label}>
            {preset.label}
          </option>
        ))}
      </select>
      {p.preset === '自定义…' && (
        <input class="qa-input" value={p.name} placeholder="名称（如 OpenAI）" onInput={(e) => p.onName((e.target as HTMLInputElement).value)} />
      )}
      <input class="qa-input" value={p.baseUrl} placeholder="Base URL（https://api.openai.com/v1）" onInput={(e) => p.onBaseUrl((e.target as HTMLInputElement).value)} />
      <input
        class="qa-input"
        type="password"
        value={p.apiKey}
        placeholder={p.editing ? 'API Key（留空保留原 Key）' : 'API Key（仅存内存，DPAPI 加密落库）'}
        onInput={(e) => p.onApiKey((e.target as HTMLInputElement).value)}
      />
      <div class="capability-group" role="group" aria-label="绑定能力（可多选）">
        {CAPABILITY_ORDER.map((id) => (
          <label key={id} class="capability-check">
            <input type="checkbox" checked={p.capabilities.has(id)} onChange={() => p.onToggleCapability(id)} />
            {CAPABILITY_LABELS[id]}
          </label>
        ))}
      </div>
      {/* 2026-09-05 批4: one model input PER checked capability — binding ASR
          to a chat model was a one-click trap with the shared field. */}
      {p.capabilities.size > 0 && (
        <div class="capability-models">
          {CAPABILITY_ORDER.filter((id) => p.capabilities.has(id)).map((id) => (
            <div key={id} class="capability-model-row">
              <label>{CAPABILITY_LABELS[id]}模型</label>
              <input
                class="qa-input"
                value={p.models[id] ?? ''}
                placeholder={id === 'asr' ? ASR_MODEL_HINT : CHAT_MODEL_HINT}
                aria-label={`${CAPABILITY_LABELS[id]}模型`}
                onInput={(e) => p.onModel(id, (e.target as HTMLInputElement).value)}
              />
            </div>
          ))}
        </div>
      )}
      <div class="provider-actions">
        <button class="btn primary" onClick={p.onSubmit} disabled={p.busy || !p.canSave}>
          {p.busy ? '保存中…' : p.editing ? '保存修改' : p.capabilities.size > 1 ? `保存并绑定 ${p.capabilities.size} 项能力` : '保存并绑定'}
        </button>
        {p.onTest != null && (
          <button class="btn" onClick={p.onTest} disabled={!p.canTest || p.busy || p.testBusy === true} title={p.canTest ? undefined : '填写 Base URL、API Key 和模型后可测试'}>
            {p.testBusy === true ? '测试中…' : '测试连接'}
          </button>
        )}
      </div>
      {p.testResult != null && (
        <p class={`provider-test ${p.testResult.ok ? 'ok' : 'fail'}`} role="status">
          {p.testResult.text}
        </p>
      )}
    </div>
  )
}

/** Settings › Provider 配置（2026-09-05 批4 重排：能力说明 → 状态 → 表单）。 */
export function ProviderPanel({ providers, busy, onSave, onRemove, onTest, testResult, testBusy = false }: ProviderPanelProps): JSX.Element {
  const [preset, setPreset] = useState(PROVIDER_PRESETS[0]!.label)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState(PROVIDER_PRESETS[0]!.name)
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0]!.baseUrl)
  const [apiKey, setApiKey] = useState('')
  // B3: one key entry can bind several capabilities at once.
  const [capabilities, setCapabilities] = useState<ReadonlySet<string>>(new Set(['asr']))
  const [models, setModels] = useState<Record<string, string>>({ asr: '', multimodal: PROVIDER_PRESETS[0]!.model, text: PROVIDER_PRESETS[0]!.model })
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)

  const configured = providers?.providers ?? []
  const hasConfigured = configured.length > 0
  // The form starts open only while there is nothing to show above it;
  // keying by editingId re-mounts the details so «编辑» opens it.
  const formKey = editingId ?? 'new'
  const formOpen = !hasConfigured || editingId != null

  const applyPreset = (label: string): void => {
    setPreset(label)
    const hit = PROVIDER_PRESETS.find((candidate) => candidate.label === label)
    if (hit == null) return
    setName(hit.name)
    setBaseUrl(hit.baseUrl)
    const chatModel = hit.model
    setModels((prev) => ({ ...prev, multimodal: chatModel, text: chatModel }))
  }

  const toggleCapability = (id: string): void => {
    setCapabilities((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // A freshly checked ASR starts empty on purpose: the placeholder names
    // the dedicated speech models, never the chat default.
    if (id === 'asr') setModels((prev) => ({ ...prev, asr: prev.asr ?? '' }))
  }

  const submit = (): void => {
    const trimmedBase = baseUrl.trim()
    const trimmedKey = apiKey.trim()
    const chosen = CAPABILITY_ORDER.filter((id) => capabilities.has(id))
    if (trimmedBase === '' || chosen.length === 0) return
    if (chosen.some((id) => (models[id] ?? '').trim() === '')) return
    if (!hasConfigured && editingId == null && trimmedKey === '') return
    onSave({
      id: editingId ?? undefined,
      name: name.trim(),
      baseUrl: trimmedBase,
      apiKey: trimmedKey,
      capabilities: [...chosen],
      models: Object.fromEntries(chosen.map((id) => [id, (models[id] ?? '').trim()]))
    })
    setApiKey('')
    setEditingId(null)
  }

  // The probe exercises the first bound capability's model (ASR endpoints
  // speak the same chat-completions probe in practice).
  const probeModel = CAPABILITY_ORDER.map((id) => models[id] ?? '').find((m) => m.trim() !== '') ?? ''
  const canTest = baseUrl.trim() !== '' && apiKey.trim() !== '' && probeModel !== ''

  const startEdit = (id: string): void => {
    const hit = configured.find((provider) => provider.id === id)
    if (hit == null) return
    setEditingId(id)
    setPreset('自定义…')
    setName(hit.name)
    setBaseUrl(hit.baseUrl)
    setApiKey('')
    const own = (providers?.bindings ?? []).filter((b) => b.providerId === id)
    setCapabilities(new Set(own.map((b) => b.capability)))
    setModels(Object.fromEntries(own.map((b) => [b.capability, b.model])))
  }

  const canSave =
    baseUrl.trim() !== '' &&
    capabilities.size > 0 &&
    CAPABILITY_ORDER.filter((id) => capabilities.has(id)).every((id) => (models[id] ?? '').trim() !== '') &&
    (editingId != null || hasConfigured || apiKey.trim() !== '')

  return (
    <section class="provider-panel">
      <h3>Provider 设置</h3>
      {/* 声明批5: 数据流向说明放这里——用户此刻正在选服务商，说在这里才有意义。
          不提跨境/出境（D7 裁决）：应用不知道你填的是境内还是境外服务商，
          断言「会跨境」在多数情况下不成立。只说能核对的事：发给谁、留存归谁管。 */}
      <p class="provider-disclosure" data-testid="provider-disclosure">
        转写与总结会把<strong>音频、视频截图和文本</strong>发送到你填写的服务商；这些数据在该服务商处的处理与留存，以它的条款为准。本软件没有开发者服务器，不上报任何数据。
      </p>
      <CapabilityNotes />
      {providers == null || !hasConfigured ? (
        <EmptyState title="尚未配置 Provider" hint="在下方表单添加一个 Provider 并绑定能力，任务管线才能运行。" />
      ) : (
        <div class="provider-list">
          {configured.map((provider) => (
            <ProviderRowView key={provider.id} provider={provider} bindings={providers.bindings} onEdit={startEdit} onDelete={setPendingDelete} />
          ))}
        </div>
      )}
      <details class="provider-add" key={formKey} open={formOpen}>
        <summary>{editingId != null ? `编辑 ${name || 'Provider'}` : '添加 Provider'}</summary>
        <ProviderForm
          preset={preset}
          editing={editingId != null}
          name={name}
          baseUrl={baseUrl}
          apiKey={apiKey}
          capabilities={capabilities}
          models={models}
          busy={busy}
          canSave={canSave}
          canTest={canTest}
          testResult={testResult}
          testBusy={testBusy}
          onPreset={applyPreset}
          onName={setName}
          onBaseUrl={setBaseUrl}
          onApiKey={setApiKey}
          onToggleCapability={toggleCapability}
          onModel={(id, value) => setModels((prev) => ({ ...prev, [id]: value }))}
          onSubmit={submit}
          onTest={() => onTest?.({ baseUrl: baseUrl.trim(), apiKey, model: probeModel })}
        />
      </details>
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
