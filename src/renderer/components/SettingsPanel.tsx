import { useEffect, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { AppSettingsInfo } from '../../shared/bridge'
import { ProviderPanel, type ProviderPanelProps } from './ProviderPanel'
import type { SessionState } from './TopBar'
import { Colonnade } from '../ui/Colonnade'
import { PageHeader } from './PageHeader'
import { Dialog } from '../ui/Dialog'

export interface SettingsPanelProps {
  settings: AppSettingsInfo | null
  session: SessionState
  /** Local session metadata (savedAt/JWT exp) shown under the account block. */
  sessionInfo: { savedAt: string | null; expiresAt: number | null }
  sessionBusy: boolean
  onLogin: () => void
  onLogout: () => void
  providers: ProviderPanelProps['providers']
  providerBusy: boolean
  onSaveProvider: ProviderPanelProps['onSave']
  onRemoveProvider: ProviderPanelProps['onRemove']
  onTestProvider?: ProviderPanelProps['onTest']
  providerTestResult?: ProviderPanelProps['testResult']
  onSetCacheDir: (dir: string) => void
  /** C10: open the folder picker; result arrives via chosenCacheDir. */
  onChooseCacheDir?: () => void
  /** C10: path picked in the folder dialog, for the draft input. */
  chosenCacheDir?: string | null
  onSetTheme: (theme: 'auto' | 'light' | 'dark') => void
  onChooseLibrary: () => void
  onOpenPath: (kind: 'library' | 'cache' | 'exports' | 'logs') => void
}

const SESSION_LABELS: Record<SessionState, string> = {
  logged_in: '已登录 CAS',
  expired: '已过期（请重新登录）',
  logged_out: '未登录'
}

function formatSessionInfo(info: SettingsPanelProps['sessionInfo']): string | null {
  if (info.expiresAt != null) return `会话有效期至 ${new Date(info.expiresAt).toLocaleString()}`
  if (info.savedAt != null) return `会话保存于 ${new Date(info.savedAt).toLocaleString()}（有效期未知）`
  return null
}

const THEME_OPTIONS: Array<{ value: 'auto' | 'light' | 'dark'; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

/** Settings page (U3): account, providers, library/cache location, theme. */
export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const [cacheDraft, setCacheDraft] = useState(props.settings?.cacheDir ?? '')
  // C10: a picked folder fills the draft once (effect, not render-phase set).
  useEffect(() => {
    if (props.chosenCacheDir != null) setCacheDraft(props.chosenCacheDir)
  }, [props.chosenCacheDir])
  // C4: logout needs a confirmation — it clears the whole working context.
  const [pendingLogout, setPendingLogout] = useState(false)
  return (
    <section class="settings-panel">
      <PageHeader title="设置" />

      <section class="settings-block">
        <h3>账号</h3>
        <div class="settings-row">
          <span class={`session-badge ${props.session}`}>{SESSION_LABELS[props.session]}</span>
          {props.session === 'logged_in' ? (
            <button class="btn" onClick={() => setPendingLogout(true)}>
              退出登录
            </button>
          ) : (
            <button class="btn primary" onClick={props.onLogin} disabled={props.sessionBusy}>
              {props.sessionBusy ? '登录中…' : '登录 CAS'}
            </button>
          )}
        </div>
        {props.session !== 'logged_out' && (
          <div class="settings-row">
            <span class="settings-hint">{formatSessionInfo(props.sessionInfo) ?? ''}</span>
          </div>
        )}
      </section>

      <section class="settings-block">
        <h3>资料库与缓存位置</h3>
        <div class="settings-row">
          <span class="settings-label">资料库</span>
          <code class="settings-path" title={props.settings?.libraryRoot ?? ''}>{props.settings?.libraryRoot ?? '…'}</code>
          <button class="btn small" onClick={props.onChooseLibrary}>
            更改
          </button>
          <button class="btn small" onClick={() => props.onOpenPath('library')}>
            打开
          </button>
        </div>
        <div class="settings-row">
          <span class="settings-label">任务缓存</span>
          <input class="qa-input" value={cacheDraft} placeholder="留空使用默认（资料库\\cache）" onInput={(e) => setCacheDraft((e.target as HTMLInputElement).value)} />
          {props.onChooseCacheDir != null && (
            <button class="btn small" onClick={props.onChooseCacheDir}>
              浏览…
            </button>
          )}
          <button class="btn small" onClick={() => props.onSetCacheDir(cacheDraft.trim())}>
            保存
          </button>
          <button class="btn small" onClick={() => props.onOpenPath('cache')}>
            打开
          </button>
        </div>
        <div class="settings-row">
          <span class="settings-label">笔记导出</span>
          <button class="btn small" onClick={() => props.onOpenPath('exports')}>
            打开导出目录
          </button>
          <span class="settings-label">日志</span>
          <button class="btn small" onClick={() => props.onOpenPath('logs')}>
            打开日志目录
          </button>
        </div>
      </section>

      <section class="settings-block">
        <h3>外观</h3>
        <div class="settings-row">
          <span class="settings-label">主题</span>
          <select class="qa-input theme-select" value={props.settings?.theme ?? 'auto'} onChange={(e) => props.onSetTheme((e.target as HTMLSelectElement).value as 'auto' | 'light' | 'dark')}>
            {THEME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section class="settings-block">
        <ProviderPanel providers={props.providers} busy={props.providerBusy} onSave={props.onSaveProvider} onRemove={props.onRemoveProvider} onTest={props.onTestProvider} testResult={props.providerTestResult} />
      </section>

      <footer class="settings-footer">
        <Colonnade size={18} />
        <span>止于至善{props.settings?.version != null ? ` · v${props.settings.version}` : ''}</span>
      </footer>

      <Dialog
        open={pendingLogout}
        title="退出登录？"
        message="将清除本机保存的学校会话；课程收藏与已生成的笔记保留，重新登录后即可继续。"
        confirmLabel="退出"
        danger
        onConfirm={() => {
          setPendingLogout(false)
          props.onLogout()
        }}
        onCancel={() => setPendingLogout(false)}
      />
    </section>
  )
}
