import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { getSetting, setSetting, readSettings, effectiveCacheDir } from '../src/main/settings/store'
import { resolveCacheDir } from '../src/main/library/paths'

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-settings-'))
  db = openDatabase(join(dir, 'app.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('settings store (U3)', () => {
  it('returns the fallback for a missing key and persists writes', () => {
    expect(getSetting(db, 'theme', 'auto')).toBe('auto')
    setSetting(db, 'theme', 'dark')
    expect(getSetting(db, 'theme', 'auto')).toBe('dark')
  })

  it('upserts: writing the same key replaces the value', () => {
    setSetting(db, 'cacheDir', 'D:\\cache')
    setSetting(db, 'cacheDir', 'E:\\cache')
    expect(getSetting(db, 'cacheDir', '')).toBe('E:\\cache')
  })

  it('readSettings echoes the effective root and ignores any stored libraryRoot (review C1)', () => {
    setSetting(db, 'libraryRoot', 'D:\\Lib')
    setSetting(db, 'theme', 'light')
    const s = readSettings(db, 'C:\\default')
    // C1: the effective root comes from the bootstrap pointer, echoed
    // here - a stale settings row must never move the library.
    expect(s.libraryRoot).toBe('C:\\default')
    expect(s.theme).toBe('light')
    expect(s.cacheDir).toBe('')
  })

  it('effectiveCacheDir resolves the override or the default under the library', () => {
    expect(effectiveCacheDir({ libraryRoot: 'D:\\Lib', cacheDir: '', theme: 'auto', disclaimerAcceptedVersion: '', copyrightNoticeVersion: '' })).toBe(join('D:\\Lib', 'cache'))
    expect(effectiveCacheDir({ libraryRoot: 'D:\\Lib', cacheDir: 'E:\\Cache', theme: 'auto', disclaimerAcceptedVersion: '', copyrightNoticeVersion: '' })).toBe('E:\\Cache')
  })

  it('resolveCacheDir trims whitespace and treats blank as default', () => {
    expect(resolveCacheDir('   ', 'R')).toBe(join('R', 'cache'))
    expect(resolveCacheDir(' C:\\x ', 'R')).toBe('C:\\x')
  })
})
