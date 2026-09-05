import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { libraryPointerFile, readLibraryPointer, writeLibraryPointer, clearLibraryPointer } from '../src/main/library/pointer'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-pointer-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('library pointer (review C1: bootstrap outside the library)', () => {
  it('round-trips the pointer through userData', () => {
    expect(readLibraryPointer(dir)).toBeNull()
    writeLibraryPointer(dir, 'E:\\Data\\SEU Library')
    expect(readLibraryPointer(dir)).toBe('E:\\Data\\SEU Library')
    expect(libraryPointerFile(dir)).toBe(join(dir, 'library-pointer.json'))
    clearLibraryPointer(dir)
    expect(readLibraryPointer(dir)).toBeNull()
  })

  it('treats a corrupt pointer as absent instead of bricking startup', () => {
    writeFileSync(libraryPointerFile(dir), '{broken json')
    expect(readLibraryPointer(dir)).toBeNull()
    // A pointer with a wrong shape is equally ignored.
    writeFileSync(libraryPointerFile(dir), JSON.stringify({ libraryRoot: 42 }))
    expect(readLibraryPointer(dir)).toBeNull()
  })
})
