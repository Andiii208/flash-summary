import { describe, expect, it, afterEach, vi } from 'vitest'
import { installProcessGuards } from '../src/main/process-guards'

describe('installProcessGuards (批5: 进程级异常兜底)', () => {
  let dispose: (() => void) | null = null

  afterEach(() => {
    dispose?.()
    dispose = null
    vi.restoreAllMocks()
  })

  it('logs an unhandled rejection instead of letting it kill the process silently', () => {
    const lines: string[] = []
    dispose = installProcessGuards({ error: (m) => lines.push(m) })

    // Inject the event the way a floating promise would raise it.
    process.emit('unhandledRejection', new Error('boom-async'), Promise.resolve())

    expect(lines.some((l) => l.includes('boom-async'))).toBe(true)
  })

  it('logs an uncaught exception and does NOT exit (no crashReporter — exiting loses the scene)', () => {
    const lines: string[] = []
    dispose = installProcessGuards({ error: (m) => lines.push(m) })
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    process.emit('uncaughtException', new Error('boom-sync'))

    expect(lines.some((l) => l.includes('boom-sync'))).toBe(true)
    expect(exit).not.toHaveBeenCalled()
  })

  it('keeps non-Error rejection reasons readable', () => {
    const lines: string[] = []
    dispose = installProcessGuards({ error: (m) => lines.push(m) })

    process.emit('unhandledRejection', 'bare-string-reason', Promise.resolve())

    expect(lines.some((l) => l.includes('bare-string-reason'))).toBe(true)
  })

  it('unwire removes the listeners so other test files stay unaffected', () => {
    // Listener-count assertions only — emitting the event after dispose would
    // leave vitest's own handler as the sole listener, which records an
    // unhandled error and fails the whole run.
    const baseRejection = process.listenerCount('unhandledRejection')
    const baseException = process.listenerCount('uncaughtException')

    dispose = installProcessGuards({ error: () => undefined })
    expect(process.listenerCount('unhandledRejection')).toBe(baseRejection + 1)
    expect(process.listenerCount('uncaughtException')).toBe(baseException + 1)

    dispose()
    dispose = null
    expect(process.listenerCount('unhandledRejection')).toBe(baseRejection)
    expect(process.listenerCount('uncaughtException')).toBe(baseException)
  })
})
