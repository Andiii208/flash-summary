/**
 * Application context: wires the library database, school client,
 * provider settings, and chat/ASR client factory together once at startup.
 * Constructed with injectable overrides so tests can drive the IPC layer
 * against stubs.
 */
import { app } from 'electron'
import { join } from 'path'
import { openDatabase, type Db } from './db/open'
import { defaultLibraryRoot, ensureLibraryLayout, resolveCacheDir, exportsPath } from './library/paths'
import { dpapiCryptor } from './auth/electron-cryptor'
import type { Cryptor } from './auth/session-crypto'
import { loadSession, saveSession, clearSession, sessionDir } from './auth/session-store'
import { openCasLoginWindow } from './auth/cas-login'
import { SchoolClient } from './school/client'
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
    globalThis.fetch as never,
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
        await openCasLoginWindow({
          serviceOrigin: CAS_BASE_URL,
          onSession: ({ cookieString, jwt }) => {
            saveSession(
              userDataDir,
              { cookies: cookieString, baseUrl: CAS_BASE_URL, savedAt: new Date().toISOString(), jwt },
              cryptor
            )
          }
        })
        logger.info('cas login succeeded (session encrypted at rest)')
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
    logsDir: () => join(userDataDir, 'logs')
  }
}

/** Test/introspection helper: where the session blob lives. */
export function sessionLocation(_ctx: AppContext, userDataDir: string): string {
  return sessionDir(userDataDir)
}
