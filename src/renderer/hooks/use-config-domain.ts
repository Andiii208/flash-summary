/**
 * Config domain (review G1, 2026-09-05): app settings + provider management.
 * The seam is clean — this domain reads nothing but the bridge and fires
 * toasts; the app shell consumes refreshProviders/refreshSettings on mount
 * and passes the rest straight to SettingsPanel.
 */
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { AppSettingsInfo, ProvidersListResult, SeuSummaryBridge } from '../../shared/bridge'
import type { ToastKind } from '../components/ToastArea'

type Toast = (message: string, kind?: ToastKind, action?: { actionLabel: string; onAction: () => void }) => void

export interface ConfigDomain {
  providers: ProvidersListResult | null
  providerBusy: boolean
  providerTest: { ok: boolean; text: string } | null
  settings: AppSettingsInfo | null
  /** 批4: per-domain load failure — the settings page shows it with a retry
      instead of an eternal blank/«…» (silent failure used to read as broken). */
  loadError: { providers: string | null; settings: string | null }
  /** C10: path picked via the folder dialog, for the draft input. */
  chosenCacheDir: string | null
  /** C3: library migration in flight (busy button + progress line). */
  libraryBusy: boolean
  migrationProgress: { copied: number; total: number } | null
  refreshProviders: () => Promise<void>
  refreshSettings: () => Promise<void>
  /** 2026-09-05 批4: one model PER capability — the UI no longer binds every
   *  checked capability to a single shared model string. */
  saveProvider: (input: { id?: string; name: string; baseUrl: string; apiKey: string; capabilities: string[]; models: Record<string, string> }) => void
  removeProvider: (id: string) => void
  testProvider: (input: { baseUrl: string; apiKey: string; model: string }) => void
  setCacheDir: (dir: string) => void
  chooseCacheDir: () => void
  setTheme: (theme: 'auto' | 'light' | 'dark') => void
  chooseLibrary: () => void
  openPath: (kind: 'library' | 'cache' | 'exports' | 'logs') => void
}

export function useConfigDomain(bridge: SeuSummaryBridge, toast: Toast): ConfigDomain {
  const [providers, setProviders] = useState<ProvidersListResult | null>(null)
  const [providerBusy, setProviderBusy] = useState(false)
  const [providerTest, setProviderTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [settings, setSettings] = useState<AppSettingsInfo | null>(null)
  const [loadError, setLoadError] = useState<{ providers: string | null; settings: string | null }>({ providers: null, settings: null })
  const [chosenCacheDir, setChosenCacheDir] = useState<string | null>(null)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState<{ copied: number; total: number } | null>(null)

  const refreshProviders = useCallback(async (): Promise<void> => {
    const res = await bridge.providers.list()
    // 批4: a silent failure here left the settings page eternally blank.
    if (res.ok && res.value != null) {
      setProviders(res.value)
      setLoadError((e) => (e.providers == null ? e : { ...e, providers: null }))
    } else {
      setLoadError((e) => ({ ...e, providers: res.error ?? '加载失败' }))
    }
  }, [bridge])

  const refreshSettings = useCallback(async (): Promise<void> => {
    const res = await bridge.settings.get()
    if (res.ok && res.value != null) {
      setSettings(res.value)
      setLoadError((e) => (e.settings == null ? e : { ...e, settings: null }))
    } else {
      setLoadError((e) => ({ ...e, settings: res.error ?? '加载失败' }))
    }
  }, [bridge])

  const saveProvider = useCallback(
    (input: { id?: string; name: string; baseUrl: string; apiKey: string; capabilities: string[]; models: Record<string, string> }): void => {
      void (async () => {
        setProviderBusy(true)
        try {
          // B3: one key entry, N capability bindings in a loop — each with its
          // own model (2026-09-05 批4). The id keeps an edit in place instead
          // of forking a second provider row on rename.
          const saved = await bridge.providers.save({ id: input.id, name: input.name, baseUrl: input.baseUrl, apiKey: input.apiKey })
          if (!saved.ok) {
            toast(saved.error ?? '保存失败', 'error')
            return
          }
          const providerId = (saved.value as { id: string }).id
          for (const capability of input.capabilities) {
            const bound = await bridge.providers.bind(capability, providerId, (input.models[capability] ?? '').trim())
            if (!bound.ok) {
              toast(bound.error ?? `绑定 ${capability} 失败`, 'error')
              return
            }
          }
          toast(`已绑定 ${input.capabilities.length} 项能力 → ${input.name}`, 'success')
          await refreshProviders()
        } finally {
          setProviderBusy(false)
        }
      })()
    },
    [bridge, toast, refreshProviders]
  )

  const removeProvider = useCallback(
    (id: string): void => {
      void (async () => {
        const res = await bridge.providers.remove(id)
        if (!res.ok) {
          toast(res.error ?? '删除失败', 'error')
          return
        }
        toast('已删除 Provider', 'success')
        await refreshProviders()
      })()
    },
    [bridge, toast, refreshProviders]
  )

  const testProvider = useCallback(
    (input: { baseUrl: string; apiKey: string; model: string }): void => {
      void (async () => {
        setProviderTest({ ok: true, text: '测试中…' })
        const res = await bridge.providers.test(input)
        if (res.ok && res.value != null) {
          setProviderTest({ ok: true, text: `连接成功（${res.value.latencyMs}ms）` })
        } else {
          setProviderTest({ ok: false, text: `连接失败：${res.error ?? '未知错误'}` })
        }
      })()
    },
    [bridge]
  )

  const setCacheDir = useCallback(
    (dir: string): void => {
      void (async () => {
        const res = await bridge.settings.setCacheDir(dir)
        if (!res.ok) {
          toast(res.error ?? '设置失败', 'error')
          return
        }
        toast('缓存目录已更新，新任务将写入新位置', 'success')
        await refreshSettings()
      })()
    },
    [bridge, toast, refreshSettings]
  )

  const chooseCacheDir = useCallback((): void => {
    void (async () => {
      const res = await bridge.settings.chooseCacheDir()
      if (!res.ok) {
        toast(res.error ?? '选择失败', 'error')
        return
      }
      if (res.value?.canceled || res.value?.path == null) return
      setChosenCacheDir(res.value.path)
    })()
  }, [bridge, toast])

  const setTheme = useCallback(
    (theme: 'auto' | 'light' | 'dark'): void => {
      void (async () => {
        const res = await bridge.settings.setTheme(theme)
        if (!res.ok) {
          toast(res.error ?? '设置失败', 'error')
          return
        }
        await refreshSettings()
      })()
    },
    [bridge, toast, refreshSettings]
  )

  // C3: live library-migration progress subscription (same discipline as school:refreshProgress).
  useEffect(() => bridge.settings.onMigrateProgress((p) => setMigrationProgress(p)), [bridge])

  const chooseLibrary = useCallback((): void => {
    if (libraryBusy) return
    void (async () => {
      // C3 (review): the migration is a long copy — the button stays
      // disabled and the progress line reports attachment entries.
      setLibraryBusy(true)
      try {
        const res = await bridge.settings.chooseLibrary()
        if (!res.ok) {
          toast(res.error ?? '迁移失败', 'error')
          return
        }
        if (res.value?.canceled) return
        toast('资料库已迁移，重启应用后生效', 'success')
        await refreshSettings()
      } finally {
        setLibraryBusy(false)
        setMigrationProgress(null)
      }
    })()
  }, [bridge, toast, refreshSettings, libraryBusy])

  const openPath = useCallback(
    (kind: 'library' | 'cache' | 'exports' | 'logs'): void => {
      // 批4: the result is checked — a dead button (目录不存在/打开失败) must
      // at least say why instead of doing nothing.
      void (async () => {
        const res = await bridge.settings.openPath(kind)
        if (!res.ok) toast(res.error ?? '打开目录失败', 'error')
      })()
    },
    [bridge, toast]
  )

  return {
    providers,
    providerBusy,
    providerTest,
    settings,
    loadError,
    chosenCacheDir,
    libraryBusy,
    migrationProgress,
    refreshProviders,
    refreshSettings,
    saveProvider,
    removeProvider,
    testProvider,
    setCacheDir,
    chooseCacheDir,
    setTheme,
    chooseLibrary,
    openPath
  }
}
