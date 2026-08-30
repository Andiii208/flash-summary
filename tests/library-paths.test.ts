import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { homedir } from 'os'
import {
  defaultLibraryRoot,
  dbPath,
  attachmentsPath,
  cachePath,
  exportsPath,
  ensureLibraryLayout
} from '../src/main/library/paths'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'

describe('library paths', () => {
  it('defaults to Documents\\SEU Summary\\Library', () => {
    expect(defaultLibraryRoot()).toBe(join(homedir(), 'Documents', 'SEU Summary', 'Library'))
  })

  it('derives the spec directory layout', () => {
    const root = join('some', 'root')
    expect(dbPath(root)).toBe(join(root, 'app.db'))
    expect(attachmentsPath(root)).toBe(join(root, 'attachments'))
    expect(cachePath(root)).toBe(join(root, 'cache'))
    expect(exportsPath(root)).toBe(join(root, 'exports'))
  })

  it('creates the layout idempotently', () => {
    const root = mkdtempSync(join(tmpdir(), 'seu-summary-lib-'))
    ensureLibraryLayout(root)
    ensureLibraryLayout(root)
    expect(existsSync(join(root, 'app.db'))).toBe(false)
    expect(existsSync(attachmentsPath(root))).toBe(true)
    expect(existsSync(cachePath(root))).toBe(true)
    expect(existsSync(exportsPath(root))).toBe(true)
  })
})
