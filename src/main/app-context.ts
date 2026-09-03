/**
 * Application context: wires the library database, school client,
 * provider settings, and chat/ASR client factory together once at startup.
 * Constructed with injectable overrides so tests can drive the IPC layer
 * against stubs.
 */
import { app, type BrowserWindow } from 'electron'
import { join } from 'path'
import { openDatabase, type Db } from './db/open'
import { defaultLibraryRoot, ensureLibraryLayout, resolveCacheDir, exportsPath } from './library/paths'
import { dpapiCryptor } from './auth/electron-cryptor'
import type { Cryptor } from './auth/session-crypto'
import { loadSession, saveSession, clearSession } from './auth/session-store'
import { openCasLoginWindow } from './auth/cas-login'
import { loginViaMainWindow, loginWindowFallbackRequested } from './auth/main-window-login'
import { SchoolClient } from './school/client'
import { harvestPlayPage, type PlayHarvestResult, type PlayPageTarget } from './school/play-harvest'
import { loadProviderSettings, upsertProvider, deleteProvider, setBinding } from './providers/store'
import { resolveCapability, validateProvider, type ProviderSettings, type Capability, type ProviderConfig } from './providers/model'
import { OpenAiCompatibleClient } from './providers/openai-client'
import { ffmpegPath, ffprobePath } from './media/binaries'
import { decodeGrid8x8 } from './media/grid'
import type { Grid8x8 } from './media/phash'
import { cleanStaleCache } from './tasks/cache-clean'
import { getSetting, setSetting, readSettings, type AppSettings } from './settings/store'
import { Logger } from './logger'

export const CAS_BASE_URL = 'https://cvs.seu.edu.cn'

export interface AppContext {
  libraryRoot: string
  db: Db
  cryptor: Cryptor
  school: SchoolClient
  providers: () => ProviderSettings
  saveProvider: (input: { id?: string; name: string; baseUrl: string; apiKey: string }) => ProviderConfig
  removeProvider: (id: string) => void
  bind: (capability: Capability, providerId: string, model: string) => void
  chatFor: (capability: Capability) => OpenAiCompatibleClient
  login: () => Promise<void>
  logout: () => void
  sessionState: () => 'logged_in' | 'logged_out'
  /**
   * One-shot flag: true exactly once after a login flow completed. The
   * renderer queries it on mount — the main window navigates away during
   * login, so the fresh mount is the only place that can react to «login
   * just finished» (auto-refresh the course tree).
   */
  consumeLoginJustCompleted: () => boolean
  /** Bundled ffmpeg/ffprobe paths (packaged resources or node_modules). */
  ffmpegPath: () => string
  ffprobePath: () => string
  /** 8x8 luminance grid decoder for keyframe dedupe. */
  gridDecoder: (path: string) => Grid8x8
  /** Resolve which capability should answer lesson Q&A (text if bound, else multimodal). */
  qaCapability: () => Capability
  /** User settings (U3): libraryRoot/cacheDir/theme. */
  settings: () => AppSettings
  setSetting: (key: string, value: string) => void
  /** Effective task-cache dir (re-read live so changes apply without restart). */
  cacheDir: () => string
  /** Directory for markdown exports. */
  exportsDir: () => string
  /** File logger (U5): userData/logs, redacted, daily-rotated. */
  logger: Logger
  /** Directory holding the log files. */
  logsDir: () => string
  /** Track the main window for in-window navigation flows (play-page harvest, V2 login). */
  setMainWindow: (win: BrowserWindow | null) => void
  /**
   * Harvest one course's play page in the main window: streams + «第N节课»
   * catalog. Navigates the window away and restores the app UI afterwards
   * (also on failure). One harvest at a time — the single window is shared.
   */
  harvestCoursePage: (target: PlayPageTarget, selectLessonRef?: string | null, signal?: AbortSignal) => Promise<PlayHarvestResult>
}

export function createContext(overrides: Partial<{
  libraryRoot: string
  userDataDir: string
  cryptor: Cryptor
}> = {}): AppContext {
  const libraryRoot = overrides.libraryRoot ?? defaultLibraryRoot()
  ensureLibraryLayout(libraryRoot)
  const db = openDatabase(join(libraryRoot, 'app.db'))
  const settings = (): AppSettings => readSettings(db, libraryRoot)
  const cacheDir = (): string => resolveCacheDir(getSetting(db, 'cacheDir', ''), libraryRoot)

  // Startup cleanup: remove cache entries older than 24h (spec §9).
  cleanStaleCache(cacheDir())

  const cryptor = overrides.cryptor ?? dpapiCryptor
  const userDataDir = overrides.userDataDir ?? app.getPath('userData')
  const logger = new Logger(join(userDataDir, 'logs'))
  logger.info(`context created (library=${libraryRoot})`)

  const jwtOf = async (): Promise<string> => {
    try {
      const session = loadSession(userDataDir, cryptor)
      return session?.jwt ?? ''
    } catch {
      return ''
    }
  }

  const school = new SchoolClient(
    `${CAS_BASE_URL}/jy-application-resourcemanage`,
    async () => {
      try {
        const session = loadSession(userDataDir, cryptor)
        return session?.cookies ?? ''
      } catch {
        return ''
      }
    },
    (url, init) => globalThis.fetch(url, init as RequestInit),
    jwtOf
  )

  const providers = (): ProviderSettings => {
    try {
      return loadProviderSettings(db, cryptor)
    } catch {
      // A plaintext/corrupt key row must not brick the app; surface empty.
      return { providers: [], bindings: [] }
    }
  }

  const chatFor = (capability: Capability): OpenAiCompatibleClient => {
    const resolved = resolveCapability(providers(), capability)
    if (resolved == null) {
      throw new Error(`能力 ${capability} 未绑定 Provider，请先在设置中配置`)
    }
    return new OpenAiCompatibleClient(resolved.provider.baseUrl, resolved.provider.apiKey)
  }

  // Main-window reference for in-window navigation flows (V1 harvest, V2
  // login). A second renderer never loads on this machine, so everything
  // happens inside this one window.
  let mainWindowRef: BrowserWindow | null = null
  let harvestInFlight: Promise<PlayHarvestResult> | null = null
  // One-shot «login just completed» marker (see consumeLoginJustCompleted).
  let loginJustCompletedAt: number | null = null

  /**
   * Push the stored session cookies into the main window's cookie jar.
   * In-window platform navigations (play page) authenticate through the
   * browser cookie jar, which is empty on a fresh instance — session.bin's
   * cookie string is what the API client sends as a header, and injecting
   * the same values into the jar passed SSO silently in the field
   * (2026-09-02). Values stay in memory and the local jar; never logged.
   */
  const injectSessionCookies = async (win: BrowserWindow): Promise<void> => {
    let cookieString = ''
    try {
      cookieString = loadSession(userDataDir, cryptor)?.cookies ?? ''
    } catch {
      cookieString = ''
    }
    if (cookieString === '') return
    const jar = win.webContents.session.cookies
    for (const pair of cookieString.split(';')) {
      const trimmed = pair.trim()
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      try {
        // Domain .seu.edu.cn so the SSO host (auth.seu.edu.cn) sees the
        // ticket cookies during the play-page redirect chain.
        await jar.set({ url: CAS_BASE_URL, domain: '.seu.edu.cn', name: trimmed.slice(0, eq), value: trimmed.slice(eq + 1), secure: true, path: '/' })
      } catch {
        // A single rejected cookie must not block the harvest.
      }
    }
  }

  /**
   * Seed the platform SPA's sessionStorage with the stored JWT before
   * navigating to a play-page route. The SPA authenticates its API calls
   * with a jwt-token header read from sessionStorage (key prefix = the SPA
   * path segment); a fresh renderer session has none and the page actively
   * logs out and bounces to the SSO login (field-traced 2026-09-02 22:52).
   * A same-origin non-SPA page provides the tab context; sessionStorage
   * survives the subsequent hash-route navigation within the tab. The JWT
   * value stays in memory and the tab's storage; never logged.
   */
  const seedSessionStorage = async (win: BrowserWindow): Promise<void> => {
    let jwt = ''
    try {
      jwt = loadSession(userDataDir, cryptor)?.jwt ?? ''
    } catch {
      jwt = ''
    }
    if (jwt === '') return
    const seedPage = `${CAS_BASE_URL}/jy-application-resourcemanage/v1/app/info`
    await win.webContents.loadURL(seedPage)
    await win.webContents.executeJavaScript(
      `sessionStorage.setItem('jy-application-resourcemanage-ui_STORAGE_KEY_JWT_TOKEN', ${JSON.stringify(jwt)}); true`,
      true
    )
  }

  const restoreMainWindow = async (): Promise<void> => {
    const win = mainWindowRef
    if (win == null || win.isDestroyed()) return
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl != null && devUrl !== '') await win.loadURL(devUrl)
    else await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const persistSession = (harvested: { cookieString: string; jwt: string }): void => {
    saveSession(
      userDataDir,
      { cookies: harvested.cookieString, baseUrl: CAS_BASE_URL, savedAt: new Date().toISOString(), jwt: harvested.jwt },
      cryptor
    )
  }

  const loginViaLegacyWindow = async (): Promise<void> => {
    await openCasLoginWindow({ serviceOrigin: CAS_BASE_URL, onSession: persistSession })
  }

  /**
   * V2.1: the login happens inside the main window (the second renderer
   * never loads). Stored cookies are injected first so an existing platform
   * session can pass SSO silently; the harvest persists cookies + JWT, and
   * the next play-page navigation re-seeds the SPA storage from session.bin
   * (seedSessionStorage), so no separate seeding is needed here.
   */
  const loginViaEmbeddedWindow = async (): Promise<void> => {
    const win = mainWindowRef
    if (win == null || win.isDestroyed()) throw new Error('主窗口不可用，无法开始登录')
    await injectSessionCookies(win)
    await loginViaMainWindow(win, {
      serviceOrigin: CAS_BASE_URL,
      restoreApp: restoreMainWindow,
      onSession: persistSession,
      logger
    })
  }

  const harvestCoursePage = async (
    target: PlayPageTarget,
    selectLessonRef?: string | null,
    signal?: AbortSignal
  ): Promise<PlayHarvestResult> => {
    if (harvestInFlight != null) {
      throw new Error('已有播放页抓取在进行中，请稍候')
    }
    const win = mainWindowRef
    if (win == null || win.isDestroyed()) {
      throw new Error('主窗口不可用，无法打开播放页')
    }
    await injectSessionCookies(win)
    await seedSessionStorage(win)
    harvestInFlight = harvestPlayPage(win, {
      origin: CAS_BASE_URL,
      target,
      selectLessonRef: selectLessonRef ?? null,
      restoreApp: restoreMainWindow,
      logger,
      signal
    }).finally(() => {
      harvestInFlight = null
    })
    return harvestInFlight
  }

  return {
    libraryRoot,
    db,
    cryptor,
    school,
    providers,
    saveProvider: (input) => {
      const provider = validateProvider({
        id: input.id ?? input.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        name: input.name,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey
      })
      upsertProvider(db, cryptor, provider)
      return provider
    },
    removeProvider: (id) => deleteProvider(db, id),
    bind: (capability, providerId, model) => setBinding(db, { capability, providerId, model }),
    chatFor,
    login: async () => {
      try {
        if (loginWindowFallbackRequested()) await loginViaLegacyWindow()
        else await loginViaEmbeddedWindow()
        loginJustCompletedAt = Date.now()
        logger.info('login succeeded (session encrypted at rest)')
      } catch (err) {
        logger.error(`cas login failed: ${(err as Error).message}`)
        throw err
      }
    },
    logout: () => clearSession(userDataDir),
    sessionState: () => {
      try {
        return loadSession(userDataDir, cryptor) != null ? 'logged_in' : 'logged_out'
      } catch {
        return 'logged_out'
      }
    },
    consumeLoginJustCompleted: () => {
      if (loginJustCompletedAt == null) return false
      loginJustCompletedAt = null
      return true
    },
    ffmpegPath,
    ffprobePath,
    gridDecoder: decodeGrid8x8,
    qaCapability: () => {
      const s = providers()
      return s.bindings.some((b) => b.capability === 'text') ? 'text' : 'multimodal'
    },
    settings,
    setSetting: (key, value) => setSetting(db, key, value),
    cacheDir,
    exportsDir: () => exportsPath(settings().libraryRoot),
    logger,
    logsDir: () => join(userDataDir, 'logs'),
    setMainWindow: (win) => {
      mainWindowRef = win
    },
    harvestCoursePage
  }
}
