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
  /** 批4: per-domain load failure — surfaced with a retry instead of eternal blank. */
  loadError?: { providers: string | null; settings: string | null }
  /** 批4: retry both config loads. */
  onRetryLoad?: () => void
  /** B站 session for the parallel account row (null = not read yet). */
  biliSession?: 'logged_in' | 'logged_out' | null
  onBiliLogout?: () => void
  onLogin: () => void
  onLogout: () => void
  providers: ProviderPanelProps['providers']
  providerBusy: boolean
  onSaveProvider: ProviderPanelProps['onSave']
  onRemoveProvider: ProviderPanelProps['onRemove']
  onTestProvider?: ProviderPanelProps['onTest']
  providerTestResult?: ProviderPanelProps['testResult']
  /** 批6: connection probe in flight — the test button disables. */
  providerTestBusy?: boolean
  onSetCacheDir: (dir: string) => void
  /** C10: open the folder picker; result arrives via chosenCacheDir. */
  onChooseCacheDir?: () => void
  /** C10: path picked in the folder dialog, for the draft input. */
  chosenCacheDir?: string | null
  onSetTheme: (theme: 'auto' | 'light' | 'dark') => void
  /** C3: migration in flight — the button disables and shows progress. */
  libraryBusy?: boolean
  migrationProgress?: { copied: number; total: number } | null
  /** 批5: a finished migration keeps a persistent restart notice on screen. */
  libraryMigrated?: boolean
  onChooseLibrary: () => void
  onOpenPath: (kind: 'library' | 'cache' | 'exports' | 'logs') => void
}

const SESSION_LABELS: Record<SessionState, string> = {
  logged_in: '已登录 CAS',
  expired: '已过期（请重新登录）',
  logged_out: '未登录'
}

function formatSessionInfo(info: SettingsPanelProps['sessionInfo'], session: SessionState): string | null {
  // 批5: an expired session must not present its past deadline as still valid.
  if (info.expiresAt != null) {
    const when = new Date(info.expiresAt).toLocaleString()
    return session === 'expired' ? `会话已于 ${when} 过期，请重新登录` : `会话有效期至 ${when}`
  }
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
  // P6 (2026-09-05): settings load async after the first paint — with the
  // settings tab restored as the initial tab the draft would stay blank and
  // read as «no cache dir configured». Refreshes only fire after a settings
  // write, so overwriting the draft here never races active editing.
  useEffect(() => {
    if (props.settings?.cacheDir != null) setCacheDraft(props.settings.cacheDir)
  }, [props.settings?.cacheDir])
  // C4: logout needs a confirmation — it clears the whole working context.
  const [pendingLogout, setPendingLogout] = useState(false)
  return (
    <section class="settings-panel">
      <PageHeader title="设置" />

      {/* 批4: 加载失败不再是永远的空白/«…»——显式错误行 + 重试。 */}
      {(props.loadError?.providers != null || props.loadError?.settings != null) && props.onRetryLoad != null && (
        <div class="settings-load-error" role="alert" data-testid="settings-load-error">
          <span>
            部分设置加载失败：{[props.loadError.providers, props.loadError.settings].filter((s): s is string => s != null).join('；')}
          </span>
          <button class="btn small" onClick={props.onRetryLoad}>
            重试
          </button>
        </div>
      )}

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
            <span class="settings-hint">{formatSessionInfo(props.sessionInfo, props.session) ?? ''}</span>
          </div>
        )}
        {/* 批1 双源并列: both accounts are managed in one place. */}
        <div class="settings-row" data-testid="bili-account-settings">
          <span class={`session-badge bili ${props.biliSession === 'logged_in' ? 'logged_in' : 'logged_out'}`}>
            <span class="badge-dot" />
            B站·{props.biliSession === 'logged_in' ? '已登录' : '未登录'}
          </span>
          {props.biliSession === 'logged_in' && props.onBiliLogout != null && (
            <button class="btn" onClick={props.onBiliLogout}>
              退出登录
            </button>
          )}
        </div>
      </section>

      <section class="settings-block">
        <h3>资料库与缓存位置</h3>
        <div class="settings-row">
          <span class="settings-label">资料库</span>
          {/* 批5: «加载中…» beats a bare «…» — the two states must not look alike. */}
          <code class="settings-path" title={props.settings?.libraryRoot ?? ''}>
            {props.settings == null ? '加载中…' : (props.settings.libraryRoot != null && props.settings.libraryRoot !== '' ? props.settings.libraryRoot : '—')}
          </code>
          <button class="btn small" onClick={props.onChooseLibrary} disabled={props.libraryBusy === true}>
            {props.libraryBusy === true ? '迁移中…' : '更改'}
          </button>
          <button class="btn small" onClick={() => props.onOpenPath('library')}>
            打开
          </button>
        </div>
        {props.migrationProgress != null && (
          <p class="settings-hint">
            正在复制附件 {props.migrationProgress.copied}/{props.migrationProgress.total} …请勿关闭应用
          </p>
        )}
        {/* 批5: 迁移完成的关键动作（重启）不再只活在 3.5s toast 里。 */}
        {props.libraryMigrated === true && (
          <p class="settings-hint migration-restart" data-testid="migration-restart-notice">
            资料库已迁移，重启应用后生效——重启前已打开的资料库仍是旧位置。
          </p>
        )}
        <div class="settings-row">
          <span class="settings-label">任务缓存</span>
          <input class="qa-input" value={cacheDraft} placeholder="留空使用默认（资料库\\cache）" onInput={(e) => setCacheDraft((e.target as HTMLInputElement).value)} />
          {props.onChooseCacheDir != null && (
            <button class="btn small" onClick={props.onChooseCacheDir}>
              浏览…
            </button>
          )}
          {/* 批5: dirty 检查——值未变时禁用保存，按钮自身即是「已保存」的确认。 */}
          <button
            class="btn small"
            disabled={props.settings == null || cacheDraft.trim() === (props.settings.cacheDir ?? '').trim()}
            title={props.settings == null ? '设置加载中…' : undefined}
            onClick={() => props.onSetCacheDir(cacheDraft.trim())}
          >
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
        </div>
        <div class="settings-row">
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
          {/* 批5: settings 未加载完成前禁用，防「跟随系统→深色」闪变误读为被重置。 */}
          <select
            class="qa-input theme-select"
            value={props.settings?.theme ?? 'auto'}
            disabled={props.settings == null}
            title={props.settings == null ? '设置加载中…' : undefined}
            onChange={(e) => props.onSetTheme((e.target as HTMLSelectElement).value as 'auto' | 'light' | 'dark')}
          >
            {THEME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section class="settings-block">
        <ProviderPanel providers={props.providers} busy={props.providerBusy} onSave={props.onSaveProvider} onRemove={props.onRemoveProvider} onTest={props.onTestProvider} testResult={props.providerTestResult} testBusy={props.providerTestBusy} />
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
