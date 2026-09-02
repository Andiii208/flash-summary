/**
 * User settings CRUD (U3). The settings table lives in the library db;
 * libraryRoot is the effective value (default or previously migrated),
 * cacheDir overrides the default cache location, theme drives the renderer.
 */
import type { Db } from '../db/open'
import { resolveCacheDir } from '../library/paths'

export type ThemeSetting = 'auto' | 'light' | 'dark'

export interface AppSettings {
  libraryRoot: string
  cacheDir: string
  theme: ThemeSetting
}

export const DEFAULT_THEME: ThemeSetting = 'auto'

export function getSetting(db: Db, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, new Date().toISOString())
}

/** Effective settings: libraryRoot falls back to the passed default. */
export function readSettings(db: Db, fallbackRoot: string): AppSettings {
  return {
    libraryRoot: getSetting(db, 'libraryRoot', fallbackRoot),
    cacheDir: getSetting(db, 'cacheDir', ''),
    theme: (getSetting(db, 'theme', DEFAULT_THEME) as ThemeSetting) || DEFAULT_THEME
  }
}

/** Effective cache directory (resolves the user override, if any). */
export function effectiveCacheDir(settings: AppSettings): string {
  return resolveCacheDir(settings.cacheDir, settings.libraryRoot)
}
