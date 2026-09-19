import { vi } from 'vitest'

/**
 * Poll `fn` (interval 50ms) until it stops throwing, then return its value.
 *
 * A thin wrapper over `vi.waitFor` that fixes the timeout at 5s: the vitest
 * default is 1s, which quietly turns a slow CI machine into a red test. Wait
 * for the state/event you care about instead of sleeping a guessed duration.
 */
export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 5000): Promise<T> {
  return vi.waitFor(fn, { timeout: timeoutMs, interval: 50 })
}
