import { describe, expect, it, vi } from 'vitest'
import { mount } from '../helpers/preact'
import { ErrorBoundary } from '../../src/renderer/ui/ErrorBoundary'

/** A child that always throws during render. */
function Boom(): null {
  throw new Error('kaput: 引擎异常')
}

describe('ErrorBoundary (review G2)', () => {
  it('renders the recovery card with the area name and the error message', () => {
    const rendererError = vi.fn(async () => undefined)
    ;(window as unknown as { seuSummary?: unknown }).seuSummary = { log: { rendererError } }
    const host = mount(<ErrorBoundary area='note-view'><Boom /></ErrorBoundary>)
    const card = host.querySelector('[data-testid="error-boundary-note-view"]')
    expect(card).not.toBeNull()
    expect(host.textContent).toContain('界面出错了')
    expect(host.textContent).toContain('kaput: 引擎异常')
    // The crash reaches the redacted file log with the area tag.
    vi.waitFor(() => expect(rendererError).toHaveBeenCalledWith('[note-view] render error: kaput: 引擎异常'))
  })
})
