import { mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Resolve the default library root:
 * `C:\Users\<username>\Documents\SEU Summary\Library`
 *
 * Uses the Windows Known Folder via the registry-free USERPROFILE shortcut.
 * On non-Windows (CI/dev on other OS) falls back to the home directory.
 */
export function defaultLibraryRoot(): string {
  const home = homedir()
  const docs = process.env.SEU_SUMMARY_DOCS_OVERRIDE ?? join(home, 'Documents')
  return join(docs, 'SEU Summary', 'Library')
}

export function dbPath(root: string): string {
  return join(root, 'app.db')
}

export function attachmentsPath(root: string): string {
  return join(root, 'attachments')
}

export function cachePath(root: string): string {
  return join(root, 'cache')
}

/**
 * Effective task-cache directory (U3). A user-set cacheDir (e.g. another
 * drive) overrides the default under the library; empty means default.
 */
export function resolveCacheDir(cacheSetting: string, libraryRoot: string): string {
  const trimmed = (cacheSetting ?? '').trim()
  return trimmed === '' ? cachePath(libraryRoot) : trimmed
}

export function exportsPath(root: string): string {
  return join(root, 'exports')
}

/** Create the library directory layout. Idempotent. */
export function ensureLibraryLayout(root: string): void {
  mkdirSync(root, { recursive: true })
  mkdirSync(attachmentsPath(root), { recursive: true })
  mkdirSync(cachePath(root), { recursive: true })
  mkdirSync(exportsPath(root), { recursive: true })
}
