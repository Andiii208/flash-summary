/**
 * Library-root bootstrap pointer (design review 2026-09-05 C1).
 *
 * The migrated-to library used to record its own location in the settings
 * table of the OLD library's db — nobody read it on the next launch, so the
 * migration never took effect. The pointer now lives OUTSIDE the library,
 * in userData, where the startup path can actually find it before opening
 * any database.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const POINTER_FILE = 'library-pointer.json'

export function libraryPointerFile(userDataDir: string): string {
  return join(userDataDir, POINTER_FILE)
}

/** The library root recorded by a previous migration, or null. */
export function readLibraryPointer(userDataDir: string): string | null {
  const file = libraryPointerFile(userDataDir)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { libraryRoot?: unknown }
    if (typeof parsed.libraryRoot === 'string' && parsed.libraryRoot.trim() !== '') {
      return parsed.libraryRoot
    }
    return null
  } catch {
    // A corrupt pointer falls back to the default root (never bricks startup).
    return null
  }
}

/** Record the library root for the next launch. */
export function writeLibraryPointer(userDataDir: string, libraryRoot: string): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(libraryPointerFile(userDataDir), JSON.stringify({ libraryRoot }, null, 2))
}

/** Remove the pointer (tests / reset to the default root). */
export function clearLibraryPointer(userDataDir: string): void {
  rmSync(libraryPointerFile(userDataDir), { force: true })
}
