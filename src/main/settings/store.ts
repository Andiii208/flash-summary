/**
 * User settings CRUD (U3). The settings table lives in the library db;
 * cacheDir overrides the default cache location, theme drives the renderer.
 * libraryRoot is NOT read from here (review C1): the effective library root
 * comes from the userData bootstrap pointer, and readSettings only echoes
 * the root the db was actually opened from.
 */
import type { Db } from '../db/open'
import { resolveCacheDir } from '../library/paths'

export type ThemeSetting = 'auto' | 'light' | 'dark'

/** C5 (review): settings keys in one place — no scattered string literals. */
export const SETTINGS_KEYS = {
  cacheDir: 'cacheDir',
  theme: 'theme',
  courseListMaxPages: 'courseListMaxPages',
  cacheQuotaGb: 'cacheQuotaGb',
  /** 批2 (plan 2026-10-07): acteId of the semester the user last refreshed ('' = platform current term). */
  courseRefreshTermId: 'courseRefreshTermId',
  /** 声明批2: the DISCLAIMER_TEXT_VERSION the user accepted ('' = never). */
  disclaimerAcceptedVersion: 'disclaimerAcceptedVersion',
  /** 声明批4: the COPYRIGHT_NOTICE_VERSION the user opted out of ('' = never). */
  copyrightNoticeVersion: 'copyrightNoticeVersion'
} as const

export interface AppSettings {
  /** The root the db was opened from (echo only — the truth is the pointer). */
  libraryRoot: string
  cacheDir: string
  theme: ThemeSetting
  /** 声明批2: accepted 使用须知文本版本（'' = 尚未接受）。 */
  disclaimerAcceptedVersion: string
  /** 声明批4: 已免除导出提醒的版权提醒文本版本（'' = 仍会提示）。 */
  copyrightNoticeVersion: string
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

/** Effective settings; theme falls back to auto on an unknown stored value. */
export function readSettings(db: Db, effectiveRoot: string): AppSettings {
  const themeRaw = getSetting(db, SETTINGS_KEYS.theme, DEFAULT_THEME)
  const theme: ThemeSetting = themeRaw === 'light' || themeRaw === 'dark' ? themeRaw : DEFAULT_THEME
  return {
    libraryRoot: effectiveRoot,
    cacheDir: getSetting(db, SETTINGS_KEYS.cacheDir, ''),
    theme,
    disclaimerAcceptedVersion: getSetting(db, SETTINGS_KEYS.disclaimerAcceptedVersion, ''),
    copyrightNoticeVersion: getSetting(db, SETTINGS_KEYS.copyrightNoticeVersion, '')
  }
}

/** Effective cache directory (resolves the user override, if any). */
export function effectiveCacheDir(settings: AppSettings): string {
  return resolveCacheDir(settings.cacheDir, settings.libraryRoot)
}
