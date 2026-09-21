/**
 * Config domain (review G1, 2026-09-05): app settings + provider management.
 * The seam is clean — this domain reads nothing but the bridge and fires
 * toasts; the app shell consumes refreshProviders/refreshSettings on mount
 * and passes the rest straight to SettingsPanel.
 */
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { AppSettingsInfo, ProvidersListResult, SeuSummaryBridge } from '../../shared/bridge'
import type { ToastKind } from '../components/ToastArea'

export type Toast = (message: string, kind?: ToastKind, action?: { actionLabel: string; onAction: () => void }) => void

export interface ConfigDomain {
  providers: ProvidersListResult | null
  providerBusy: boolean
  providerTest: { ok: boolean; text: string } | null
  /** 批6: true while the connection probe runs — the test button disables. */
  providerTestBusy: boolean
  settings: AppSettingsInfo | null
  /** 批4: per-domain load failure — the settings page shows it with a retry
      instead of an eternal blank/«…» (silent failure used to read as broken). */
  loadError: { providers: string | null; settings: string | null }
  /** C10: path picked via the folder dialog, for the draft input. */
  chosenCacheDir: string | null
  /** C3: library migration in flight (busy button + progress line). */
  libraryBusy: boolean
  migrationProgress: { copied: number; total: number } | null
  /** 批5: a finished migration survives as a persistent restart notice on the
      settings page — it used to live only in a 3.5s toast. */
  libraryMigrated: boolean
  /** 批4 (P8/D4): 返回刷新后的绑定（供保存路径判断「有没有多模态」），
      失败时为 null——调用方照旧可以只 await。 */
  refreshProviders: () => Promise<ProvidersListResult | null>
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
  /** 声明批2: record first-run consent for the current text version, then
   *  re-read settings so the gate lifts from the authoritative stored value
   *  (never from a local flag — that could show a shell main never accepted). */
  acceptDisclaimer: () => void
  /** 声明批4: record «不再提示» for the export copyright notice, then re-read
   *  settings so the exemption comes from the stored value. */
  optOutCopyrightNotice: () => void
  /** 声明批6: 打开测试期反馈表（地址在 main 侧，无参 IPC，渲染层传不了 URL）。 */
  openFeedbackForm: () => void
  /** 2026-09-21: 打开作者的 GitHub 主页（地址在 main 侧，无参 IPC）。 */
  openAuthorGithub: () => void
  /** 批6 (D4): 资料库备份导出（busy 三件套同其它慢操作按钮）。 */
  libraryBackupBusy: boolean
  exportLibraryBackup: () => void
}

export function useConfigDomain(bridge: SeuSummaryBridge, toast: Toast): ConfigDomain {
  const [providers, setProviders] = useState<ProvidersListResult | null>(null)
  const [providerBusy, setProviderBusy] = useState(false)
  const [providerTest, setProviderTest] = useState<{ ok: boolean; text: string } | null>(null)
  /** 批6: connection probe in flight (disables the test button). */
  const [providerTestBusy, setProviderTestBusy] = useState(false)
  const [settings, setSettings] = useState<AppSettingsInfo | null>(null)
  const [loadError, setLoadError] = useState<{ providers: string | null; settings: string | null }>({ providers: null, settings: null })
  const [chosenCacheDir, setChosenCacheDir] = useState<string | null>(null)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [libraryMigrated, setLibraryMigrated] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState<{ copied: number; total: number } | null>(null)
  /** 批6 (D4): 备份进行中——按钮禁用 + 文案省略号，防连点重复写盘。 */
  const [libraryBackupBusy, setLibraryBackupBusy] = useState(false)

  const refreshProviders = useCallback(async (): Promise<ProvidersListResult | null> => {
    const res = await bridge.providers.list()
    // 批4: a silent failure here left the settings page eternally blank.
    if (res.ok && res.value != null) {
      setProviders(res.value)
      setLoadError((e) => (e.providers == null ? e : { ...e, providers: null }))
      return res.value
    }
    setLoadError((e) => ({ ...e, providers: res.error ?? '加载失败' }))
    return null
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
          // 批4 (P14): 该 provider 原有、本次未勾选的能力随保存解绑——此前只有
          // bind 没有 unbind，用户取消勾选后列表徽标与任务管线照旧用它（「关了
          // 却还开着」）。原有绑定取自已加载的列表，按 providerId 过滤。
          const toUnbind = (providers?.bindings ?? []).filter(
            (b) => b.providerId === providerId && !input.capabilities.includes(b.capability)
          )
          // 批6: a failed binding used to abandon the refresh — the list then
          // showed a stale state while the provider row WAS saved.
          for (const capability of input.capabilities) {
            const bound = await bridge.providers.bind(capability, providerId, (input.models[capability] ?? '').trim())
            if (!bound.ok) {
              toast(`Provider 已保存，但能力 ${capability} 绑定失败：${bound.error ?? '未知错误'}`, 'error')
              await refreshProviders()
              return
            }
          }
          for (const binding of toUnbind) {
            const released = await bridge.providers.unbind(binding.capability)
            if (!released.ok) {
              toast(`Provider 已保存，但能力 ${binding.capability} 解绑失败：${released.error ?? '未知错误'}`, 'error')
              await refreshProviders()
              return
            }
          }
          const after = await refreshProviders()
          // 批4 (P8/D4): 保存成功不等于管线可用——缺多模态绑定时当场指路，不等
          // 用户建任务才以 toast 发现（那时已经白等一轮）。判据取刷新后的真实绑定，
          // 不是「这次勾了什么」——多模态可能绑在另一个 provider 上。
          if (after != null && !after.bindings.some((b) => b.capability === 'multimodal')) {
            toast('已保存。生成笔记还需要多模态总结模型——在上面勾选并绑定', 'info')
            return
          }
          const boundPart = `已绑定 ${input.capabilities.length} 项能力`
          toast(toUnbind.length > 0 ? `${boundPart}，解绑 ${toUnbind.length} 项能力 → ${input.name}` : `${boundPart} → ${input.name}`, 'success')
        } finally {
          setProviderBusy(false)
        }
      })()
    },
    [bridge, toast, refreshProviders, providers]
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
      // 批6: a second click while the probe is in flight re-fired the request.
      if (providerTestBusy) return
      void (async () => {
        setProviderTestBusy(true)
        try {
          setProviderTest({ ok: true, text: '测试中…' })
          const res = await bridge.providers.test(input)
          if (res.ok && res.value != null) {
            setProviderTest({ ok: true, text: `连接成功（${res.value.latencyMs}ms）` })
          } else {
            setProviderTest({ ok: false, text: `连接失败：${res.error ?? '未知错误'}` })
          }
        } finally {
          setProviderTestBusy(false)
        }
      })()
    },
    [bridge, providerTestBusy]
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
        setLibraryMigrated(true)
        toast('资料库已迁移，重启应用后生效', 'success')
        await refreshSettings()
      } finally {
        setLibraryBusy(false)
        setMigrationProgress(null)
      }
    })()
  }, [bridge, toast, refreshSettings, libraryBusy])

  // 批6 (D4): 资料库备份导出。main 侧 db.backup 是 WAL 一致快照，失败/取消都
  // 由 main 兜底（不留半成品）；这里只做 in-flight 守卫 + 完成 toast（带「打开
  // 所在文件夹」——备份落点用户自选，reveal 走 main 记下的一次性放行）。
  const exportLibraryBackup = useCallback((): void => {
    if (libraryBackupBusy) return
    void (async () => {
      setLibraryBackupBusy(true)
      try {
        const res = await bridge.settings.exportLibraryBackup()
        if (!res.ok) {
          toast(res.error ?? '备份失败', 'error')
          return
        }
        if (res.value?.canceled) return
        const filePath = res.value?.path ?? ''
        toast('资料库备份完成', 'success', {
          actionLabel: '打开所在文件夹',
          onAction: () => {
            void bridge.notes.revealFile(filePath)
          }
        })
      } finally {
        setLibraryBackupBusy(false)
      }
    })()
  }, [bridge, toast, libraryBackupBusy])

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

  const acceptDisclaimer = useCallback((): void => {
    void (async () => {
      const res = await bridge.settings.acceptDisclaimer()
      // 声明批2: a failed write must NOT lift the gate — the user would be let
      // through on a consent the database never recorded, and the next launch
      // would ask again with no explanation.
      if (!res.ok) {
        toast(res.error ?? '无法记录同意状态，请重试', 'error')
        return
      }
      await refreshSettings()
    })()
  }, [bridge, toast, refreshSettings])

  const optOutCopyrightNotice = useCallback((): void => {
    void (async () => {
      // 声明批4: a failed write only means the notice shows again next time —
      // honest, and not worth blocking the export the user already confirmed.
      const res = await bridge.settings.optOutCopyrightNotice()
      if (!res.ok) {
        toast(res.error ?? '无法记录「不再提示」，下次导出还会提醒', 'error')
        return
      }
      await refreshSettings()
    })()
  }, [bridge, toast, refreshSettings])

  const openFeedbackForm = useCallback((): void => {
    void (async () => {
      // 声明批6: the IPC carries no URL — main owns the address. A failure here
      // (no browser handler) must say so instead of looking like a dead button.
      const res = await bridge.feedback.openForm()
      if (!res.ok) toast(res.error ?? '打开反馈表失败', 'error')
    })()
  }, [bridge, toast])

  /** 2026-09-21: 同上——地址在 main 侧，失败必须说出来而不是当死按钮。 */
  const openAuthorGithub = useCallback((): void => {
    void (async () => {
      const res = await bridge.settings.openAuthor()
      if (!res.ok) toast(res.error ?? '打开 GitHub 主页失败', 'error')
    })()
  }, [bridge, toast])

  return {
    providers,
    providerBusy,
    providerTest,
    providerTestBusy,
    settings,
    loadError,
    chosenCacheDir,
    libraryBusy,
    libraryMigrated,
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
    libraryBackupBusy,
    exportLibraryBackup,
    openPath,
    acceptDisclaimer,
    optOutCopyrightNotice,
    openFeedbackForm,
    openAuthorGithub
  }
}
