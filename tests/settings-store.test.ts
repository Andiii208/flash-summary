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

  it('readSettings merges stored values with the passed default root', () => {
    setSetting(db, 'libraryRoot', 'D:\\Lib')
    setSetting(db, 'theme', 'light')
    const s = readSettings(db, 'C:\\default')
    expect(s.libraryRoot).toBe('D:\\Lib')
    expect(s.theme).toBe('light')
    expect(s.cacheDir).toBe('')
  })

  it('effectiveCacheDir resolves the override or the default under the library', () => {
    expect(effectiveCacheDir({ libraryRoot: 'D:\\Lib', cacheDir: '', theme: 'auto' })).toBe(join('D:\\Lib', 'cache'))
    expect(effectiveCacheDir({ libraryRoot: 'D:\\Lib', cacheDir: 'E:\\Cache', theme: 'auto' })).toBe('E:\\Cache')
  })

  it('resolveCacheDir trims whitespace and treats blank as default', () => {
    expect(resolveCacheDir('   ', 'R')).toBe(join('R', 'cache'))
    expect(resolveCacheDir(' C:\\x ', 'R')).toBe('C:\\x')
  })
})
