/**
 * Logout's browser-side cleanup (review 2026-09-05 A8). Extracted from
 * app-context so the «both partitions» contract is unit-testable: leftover
 * valid SSO cookies in EITHER partition silently resurrect the old session
 * on the next login, and the platform parks a refresh token in
 * localStorage. sessionStorage dies with the tab — nothing to clear there.
 */
export interface ClearableSession {
  /** Electron's real signature has an optional options object — keep the
   *  test double's shape a strict superset of what we actually pass. */
  clearStorageData(options?: { storages?: readonly string[] }): Promise<void>
}

export const CLEARABLE_STORAGES = ['cookies', 'localstorage'] as const

export async function clearBrowserSessionState(
  defaultSession: ClearableSession | null,
  legacyPartition: ClearableSession | null,
  log: (message: string) => void,
  logError: (message: string) => void
): Promise<void> {
  const targets: Array<{ label: string; ses: ClearableSession }> = []
  if (defaultSession != null) targets.push({ label: 'default', ses: defaultSession })
  if (legacyPartition != null) targets.push({ label: 'persist:seu-cas', ses: legacyPartition })
  for (const { label, ses } of targets) {
    try {
      await ses.clearStorageData({ storages: [...CLEARABLE_STORAGES] })
    } catch (err) {
      // One partition failing must not skip the other's cleanup.
      logError(`logout: clearing browser state (${label}) failed: ${(err as Error).message}`)
    }
  }
  log('logout: browser cookies and storage cleared (default + legacy partition)')
}
