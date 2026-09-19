/**
 * Application context: wires the library database, school client,
 * provider settings, and chat/ASR client factory together once at startup.
 * Constructed with injectable overrides so tests can drive the IPC layer
 * against stubs.
 */
import { app, session, type BrowserWindow } from 'electron'
import { join } from 'path'
import { openDatabase, type Db } from './db/open'
import { defaultLibraryRoot, ensureLibraryLayout, resolveCacheDir, exportsPath } from './library/paths'
import { dpapiCryptor } from './auth/electron-cryptor'
import type { Cryptor } from './auth/session-crypto'
import { loadSession, saveSession, clearSession, jwtExpiresAt } from './auth/session-store'
import { loadBilibiliSession, saveBilibiliSession, clearBilibiliSession } from './auth/bilibili-session-store'
import { injectSessionCookiesIntoJar } from './auth/cookie-inject'
import { clearBrowserSessionState } from './auth/browser-clear'
import type { SessionStateValue } from '../shared/types'
import { openCasLoginWindow } from './auth/cas-login'
import { loginViaMainWindow, loginWindowFallbackRequested } from './auth/main-window-login'
import { SchoolClient } from './school/client'
import { BilibiliClient, type FetchLike } from './bilibili/client'
import { harvestPlayPage, type PlayHarvestResult, type PlayPageTarget } from './school/play-harvest'
import { loadProviderSettings, upsertProvider, deleteProvider, setBinding } from './providers/store'
import { resolveCapability, validateProvider, type ProviderSettings, type Capability, type ProviderConfig } from './providers/model'
import { OpenAiCompatibleClient } from './providers/openai-client'
import { ffmpegPath, ffprobePath } from './media/binaries'
import { decodeGridPreferThumb } from './media/grid'
import type { Grid8x8 } from '../shared/phash'
import { cleanStaleCache, cleanStaleCrashDumps, pruneStaleSignedUrlHandoffs, cleanOrphanAttachmentDirs, activeLessonIds } from './tasks/cache-clean'
import { getSetting, setSetting, readSettings, SETTINGS_KEYS, type AppSettings } from './settings/store'
import { readLibraryPointer } from './library/pointer'
import { Logger } from './logger'

export const CAS_BASE_URL = 'https://cvs.seu.edu.cn'

export interface AppContext {
  libraryRoot: string
  /** userData dir — home of the library bootstrap pointer and logs. */
  userDataDir: string
  db: Db
  cryptor: Cryptor
  school: SchoolClient
  /** Bilibili web-API client (source #2, plan 2026-09-06): subtitle/playurl/QR login. */
  bilibili: BilibiliClient
  /** QR login step 1: render `qrUrl` as a QR image in the renderer. */
  bilibiliLoginStart: () => Promise<{ qrUrl: string }>
  /**
   * QR login step 2: one throttled poll (≥1s against the passport API).
   * `inactive` = no login session running (start one first); `confirmed`
   * has already persisted the encrypted session by the time it is reported.
   */
  bilibiliLoginPoll: () => Promise<{ status: 'inactive' | 'waiting' | 'scanned' | 'confirmed' | 'expired' }>
  bilibiliLogout: () => void
  bilibiliSessionState: () => 'logged_in' | 'logged_out'
  bilibiliSessionMeta: () => { savedAt: string | null }
  providers: () => ProviderSettings
  saveProvider: (input: { id?: string; name: string; baseUrl: string; apiKey: string }) => ProviderConfig
  removeProvider: (id: string) => void
  bind: (capability: Capability, providerId: string, model: string) => void
  chatFor: (capability: Capability) => OpenAiCompatibleClient
  login: () => Promise<void>
  logout: () => Promise<void>
  sessionState: () => SessionStateValue
  /** Local session metadata (savedAt/JWT exp) for the settings page — no network. */
  sessionMeta: () => { savedAt: string | null; expiresAt: number | null }
  /**
   * One-shot flag: true exactly once after a login flow completed. The
   * renderer queries it on mount — the main window navigates away during
   * login, so the fresh mount is the only place that can react to «login
   * just finished» (auto-refresh the course tree).
   */
  consumeLoginJustCompleted: () => boolean
  /**
   * One-shot outcome of the last embedded (main-window) login flow. The
   * initiating renderer is unloaded by the navigation, so its promise
   * handlers die with it — without this channel a failed login is fully
   * silent (field case 2026-09-03: «点了登录没反应»). Consumed on mount
   * via school:session. Null when no embedded login ran since last read.
   */
  consumeLoginOutcome: () => { ok: boolean; message: string } | null
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
  /**
   * 批C: catalog-harvest visibility. The initiating renderer is unloaded by
   * the play-page navigation, so the in-flight set and the outcome live here;
   * the fresh mount polls school:harvestState to show progress and report
   * success/failure. `outcome` keeps the LAST result (never cleared) — the
   * renderer dedupes repeat toasts via the monotonic seq.
   */
  harvestRuntime: {
    inflight: ReadonlySet<string>
    /**
     * Claim the course; returns true only when THIS call newly took the
     * in-flight slot (批5: a second same-course call loses the single-flight
     * race and must not `finish` — that would clear the first harvest's
     * marker and overwrite its outcome).
     */
    start: (courseId: string) => boolean
    finish: (courseId: string, result: { ok: boolean; lessons: number; error?: string }) => void
    state: () => {
      inflight: string[]
      outcome: { seq: number; courseId: string; ok: boolean; lessons: number; error?: string } | null
    }
  }
}

/**
 * Bilibili QR-login poll result cache window (ms). The renderer drives the
 * state machine by re-invoking loginStatus far more often than the passport
 * API tolerates, so one real poll per this window is what the login flow
 * gets; `bilibiliLoginPoll` below is the only writer of the constant.
 * Tests import it to express "wait one cache window" without re-deriving 1000.
 */
export const BILIBILI_POLL_CACHE_MS = 1000

export function createContext(overrides: Partial<{
  libraryRoot: string
  userDataDir: string
  cryptor: Cryptor
  bilibiliFetch: FetchLike
}> = {}): AppContext {
  const userDataDir = overrides.userDataDir ?? app.getPath('userData')
  // C1 (review): the library root comes from the userData bootstrap pointer
  // written by the last successful migration — never from the settings
  // table of the db we are about to open (that pointer was unread by
  // design). Explicit overrides (tests/smoke) win over everything.
  const pointerRoot = readLibraryPointer(userDataDir)
  const libraryRoot = overrides.libraryRoot ?? pointerRoot ?? defaultLibraryRoot()
  ensureLibraryLayout(libraryRoot)
  const db = openDatabase(join(libraryRoot, 'app.db'))
  const settings = (): AppSettings => readSettings(db, libraryRoot)
  const cacheDir = (): string => resolveCacheDir(getSetting(db, SETTINGS_KEYS.cacheDir, ''), libraryRoot)

  const cryptor = overrides.cryptor ?? dpapiCryptor
  const logger = new Logger(join(userDataDir, 'logs'))

  // Startup cleanup: remove cache entries older than 24h (spec §9) and
  // enforce the cache quota (review B5: default 20GB, setting cacheQuotaGb;
  // the startup sweep always sees an empty queue, and task-deletion races
  // are guarded at the queue layer — 批D).
  const quotaGbRaw = Number(getSetting(db, SETTINGS_KEYS.cacheQuotaGb, ''))
  const quotaGb = Number.isFinite(quotaGbRaw) && quotaGbRaw > 0 ? Math.floor(quotaGbRaw) : 20
  try {
    const removed = cleanStaleCache(cacheDir(), Date.now(), 24 * 60 * 60 * 1000, new Set(), quotaGb * 1024 ** 3)
    if (removed.length > 0) logger.info(`startup cache cleanup removed ${removed.length} entries (quota ${quotaGb}GB)`)
  } catch {
    // A broken cache dir must not brick startup.
  }

  // H2 (review): crash minidumps may contain in-memory secrets — never keep them a week.
  try {
    const dumps = cleanStaleCrashDumps(userDataDir)
    if (dumps > 0) logger.info(`startup sweep removed ${dumps} stale crash dumps`)
  } catch {
    // The sweep must never brick startup.
  }

  // 批6 修复轮 I1: 孤儿附件目录清扫——removeCourse 的 rmSync 失败/迁移半途/
  // 崩溃都会留下「DB 无 lessons 行」的 attachments/<lessonId> 目录（缓存清扫
  // 从不碰附件目录）。判据 = 无 lessons 行 且 mtime > 24h；在跑/排队任务的
  // 课时目录排除。批6 removeCourse 注释里「24h sweep 兜底」这句话到这里才成真。
  try {
    const orphaned = cleanOrphanAttachmentDirs(db, libraryRoot, Date.now(), 24 * 60 * 60 * 1000, activeLessonIds(db))
    if (orphaned.length > 0) logger.info(`startup sweep removed ${orphaned.length} orphan attachment dirs`)
  } catch {
    // The sweep must never brick startup.
  }

  // 声明批7（plan 2026-09-11）: 失败任务为支持续跑保留的签名直链有保质期——过了
  // auth_key 的新鲜窗口就只剩风险没有用途（续跑那时本来就会重新收割）。启动时删。
  try {
    const stale = pruneStaleSignedUrlHandoffs(db)
    if (stale > 0) logger.info(`startup sweep removed ${stale} stale signed-url handoffs`)
  } catch {
    // The sweep must never brick startup.
  }

  logger.info(`context created (library=${libraryRoot}${pointerRoot != null ? ', via pointer' : ', default'})`)

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

  // Bilibili source (plan 2026-09-06): same cookie discipline as the school
  // client — SESSDATA rides the encrypted bilibili-session file. The fetch
  // is injectable so the IPC tests can drive the QR-login state machine
  // against fixtures without touching the network.
  const bilibili = new BilibiliClient(
    async () => {
      try {
        return loadBilibiliSession(userDataDir, cryptor)?.cookies ?? ''
      } catch {
        return ''
      }
    },
    overrides.bilibiliFetch ?? ((url, init) => globalThis.fetch(url, init as RequestInit))
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
  // One-shot outcome of the last embedded login (see consumeLoginOutcome).
  let lastLoginOutcome: { ok: boolean; message: string } | null = null

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
    // Lives in auth/cookie-inject.ts so the jar contract (httpOnly!) is
    // unit-testable without a BrowserWindow (review 2026-09-05 A5).
    await injectSessionCookiesIntoJar(win.webContents.session.cookies, cookieString, CAS_BASE_URL)
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

  /**
   * 退出登录的浏览器侧清理（field-traced 坑：logout 只删 session.bin）：
   * cookie 罐里残留的有效 SSO cookie 会让下一次登录静默复用旧会话，平台
   * 还把 refresh token 放在 localStorage。defaultSession = 主窗口使用的
   * 会话；persist:seu-cas = 旧独立登录窗分区（SEU_LOGIN_WINDOW=1 回退路
   * 径），不清它的话 legacy 登录残留同样能复活会话（review 2026-09-05 A8）。
   * sessionStorage 随标签页生命周期消亡，无需处理。实现抽取在
   * auth/browser-clear.ts 以便两个分区契约可测。
   */
  const logoutBrowserCleanup = async (): Promise<void> => {
    await clearBrowserSessionState(
      session?.defaultSession ?? null,
      session != null ? session.fromPartition('persist:seu-cas') : null,
      (message) => logger.info(message),
      (message) => logger.error(message)
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

  // Bilibili QR-login state machine (plan 2026-09-06 M3). The renderer
  // drives it: login() → render qrUrl → poll loginStatus() ~1.5s apart.
  // Polls are cached for 1s so renderer remounts cannot hammer the
  // passport endpoint. `confirmed` persists the DPAPI-sealed session
  // before the status is reported; the cookie string never reaches a log.
  let bilibiliQr: { qrcodeKey: string } | null = null
  let bilibiliPollCache: { at: number; result: { status: 'inactive' | 'waiting' | 'scanned' | 'confirmed' | 'expired' } } | null = null
  let bilibiliLastPollStatus: string | null = null

  const bilibiliLoginStart = async (): Promise<{ qrUrl: string }> => {
    const qr = await bilibili.qrGenerate()
    bilibiliQr = { qrcodeKey: qr.qrcodeKey }
    bilibiliPollCache = null
    bilibiliLastPollStatus = null
    logger.info('bilibili qr login started')
    return { qrUrl: qr.qrUrl }
  }

  const bilibiliLoginPoll = async (): Promise<{ status: 'inactive' | 'waiting' | 'scanned' | 'confirmed' | 'expired' }> => {
    if (bilibiliQr == null) return { status: 'inactive' }
    if (bilibiliPollCache != null && Date.now() - bilibiliPollCache.at < BILIBILI_POLL_CACHE_MS) return bilibiliPollCache.result
    let poll
    try {
      poll = await bilibili.qrPoll(bilibiliQr.qrcodeKey)
    } catch (err) {
      // The confirm response is one-shot — a swallowed error here used to
      // surface only as a later «86038 expired». Keep the qrcode alive and
      // leave an explicit evidence line.
      logger.error(`bilibili qr poll failed: ${(err as Error).message}`)
      throw err
    }
    // Status-transition log: the evidence trail when a scan misbehaves
    // (2026-09-07 field case: poll stuck at waiting through a confirmed scan).
    if (poll.status !== bilibiliLastPollStatus) {
      logger.info(`bilibili qr poll: ${bilibiliLastPollStatus ?? 'start'} → ${poll.status}`)
      bilibiliLastPollStatus = poll.status
    }
    if (poll.status === 'confirmed' && poll.cookies != null) {
      saveBilibiliSession(
        userDataDir,
        { cookies: poll.cookies, baseUrl: 'https://www.bilibili.com', savedAt: new Date().toISOString() },
        cryptor
      )
      bilibiliQr = null
      logger.info('bilibili login succeeded (session encrypted at rest)')
    } else if (poll.status === 'expired') {
      bilibiliQr = null
    }
    const result = { status: poll.status }
    bilibiliPollCache = { at: Date.now(), result }
    return result
  }

  return {
    libraryRoot,
    userDataDir,
    db,
    cryptor,
    school,
    bilibili,
    bilibiliLoginStart,
    bilibiliLoginPoll,
    bilibiliLogout: () => {
      clearBilibiliSession(userDataDir)
      bilibiliQr = null
      bilibiliPollCache = null
    },
    bilibiliSessionState: () => {
      try {
        return loadBilibiliSession(userDataDir, cryptor) != null ? 'logged_in' : 'logged_out'
      } catch {
        return 'logged_out'
      }
    },
    bilibiliSessionMeta: () => {
      try {
        return { savedAt: loadBilibiliSession(userDataDir, cryptor)?.savedAt ?? null }
      } catch {
        return { savedAt: null }
      }
    },
    providers,
    saveProvider: (input) => {
      const id = input.id ?? input.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
      // A6 (review 2026-09-05): an empty key on edit means «keep the stored
      // key» — re-typing the secret on every rename pushed users to keep it
      // on the clipboard. A brand-new provider with no key is an error.
      let apiKey = input.apiKey
      if (apiKey === '') {
        apiKey = providers().providers.find((p) => p.id === id)?.apiKey ?? ''
      }
      if (apiKey === '') {
        throw new Error('API Key 必填：新 Provider 必须填写；编辑已有 Provider 时留空表示保留原 Key')
      }
      const provider = validateProvider({
        id,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKey
      })
      upsertProvider(db, cryptor, provider)
      return provider
    },
    removeProvider: (id) => deleteProvider(db, id),
    bind: (capability, providerId, model) => setBinding(db, { capability, providerId, model }),
    chatFor,
    login: async () => {
      try {
        if (loginWindowFallbackRequested()) {
          // Legacy window: the renderer survives, its own promise handler
          // reports the result — no outcome channel needed.
          await loginViaLegacyWindow()
        } else {
          try {
            await loginViaEmbeddedWindow()
            lastLoginOutcome = { ok: true, message: '' }
          } catch (err) {
            lastLoginOutcome = { ok: false, message: (err as Error).message }
            throw err
          }
        }
        loginJustCompletedAt = Date.now()
        logger.info('login succeeded (session encrypted at rest)')
      } catch (err) {
        logger.error(`cas login failed: ${(err as Error).message}`)
        throw err
      }
    },
    logout: async () => {
      clearSession(userDataDir)
      // Awaited so a fast app quit cannot skip the cookie-jar cleanup
      // (fire-and-forget previously raced app exit — review A8).
      await logoutBrowserCleanup()
    },
    sessionState: () => {
      try {
        const rec = loadSession(userDataDir, cryptor)
        if (rec == null) return 'logged_out'
        const expiresAt = jwtExpiresAt(rec.jwt)
        return expiresAt != null && expiresAt <= Date.now() ? 'expired' : 'logged_in'
      } catch {
        return 'logged_out'
      }
    },
    sessionMeta: () => {
      try {
        const rec = loadSession(userDataDir, cryptor)
        if (rec == null) return { savedAt: null, expiresAt: null }
        return { savedAt: rec.savedAt, expiresAt: jwtExpiresAt(rec.jwt) }
      } catch {
        return { savedAt: null, expiresAt: null }
      }
    },
    consumeLoginJustCompleted: () => {
      if (loginJustCompletedAt == null) return false
      loginJustCompletedAt = null
      return true
    },
    consumeLoginOutcome: () => {
      const outcome = lastLoginOutcome
      lastLoginOutcome = null
      return outcome
    },
    ffmpegPath,
    ffprobePath,
    // 批3: 有 64px 缩略图解缩略图（哈希专用、只读 KB 级），没有回落原图。
    gridDecoder: decodeGridPreferThumb,
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
    harvestCoursePage,
    harvestRuntime: (() => {
      const inflight = new Set<string>()
      let lastSeq = 0
      let outcome: { seq: number; courseId: string; ok: boolean; lessons: number; error?: string } | null = null
      return {
        inflight,
        start: (courseId: string): boolean => {
          if (inflight.has(courseId)) return false
          inflight.add(courseId)
          return true
        },
        finish: (courseId: string, result: { ok: boolean; lessons: number; error?: string }): void => {
          inflight.delete(courseId)
          outcome = { seq: ++lastSeq, courseId, ...result }
        },
        state: () => ({ inflight: [...inflight], outcome })
      }
    })()
  }
}
