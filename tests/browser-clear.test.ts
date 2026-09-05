import { describe, expect, it } from 'vitest'
import { clearBrowserSessionState, CLEARABLE_STORAGES, type ClearableSession } from '../src/main/auth/browser-clear'

function fakeSession(): ClearableSession & { cleared: string[][] } {
  const cleared: string[][] = []
  return {
    cleared,
    clearStorageData: async (options) => {
      cleared.push([...(options?.storages ?? [])])
    }
  }
}

describe('clearBrowserSessionState (review A8: both partitions, awaited)', () => {
  it('clears cookies and localStorage on both the default session and the legacy partition', async () => {
    const def = fakeSession()
    const legacy = fakeSession()
    const logs: string[] = []
    const errors: string[] = []
    await clearBrowserSessionState(def, legacy, (m) => logs.push(m), (m) => errors.push(m))
    expect(def.cleared).toEqual([['cookies', 'localstorage']])
    expect(legacy.cleared).toEqual([['cookies', 'localstorage']])
    expect(errors).toEqual([])
    expect(logs).toHaveLength(1)
  })

  it('one partition failing does not skip the other cleanup', async () => {
    const def = fakeSession()
    const legacy: ClearableSession = {
      clearStorageData: async () => {
        throw new Error('partition busy')
      }
    }
    const errors: string[] = []
    await clearBrowserSessionState(def, legacy, () => undefined, (m) => errors.push(m))
    expect(def.cleared).toEqual([['cookies', 'localstorage']])
    expect(errors[0]).toContain('persist:seu-cas')
    expect(errors[0]).toContain('partition busy')
  })

  it('tolerates both sessions being absent (electron unavailable in unit tests)', async () => {
    const logs: string[] = []
    await clearBrowserSessionState(null, null, (m) => logs.push(m), () => undefined)
    expect(logs).toHaveLength(1)
    expect([...CLEARABLE_STORAGES]).toEqual(['cookies', 'localstorage'])
  })
})
