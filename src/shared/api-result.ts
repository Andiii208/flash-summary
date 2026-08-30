/**
 * IPC result envelope shared between main handlers, preload bridge, and
 * the renderer. Every cross-process call answers with this shape so the
 * renderer never receives raw exceptions.
 */
export interface ApiResult<T> {
  ok: boolean
  value?: T
  error?: string
  kind?: string
}

export function okResult<T>(value: T): ApiResult<T> {
  return { ok: true, value }
}

export function errResult(error: unknown): ApiResult<never> {
  const e = error as { message?: string; kind?: string }
  return { ok: false, error: e.message ?? String(error), kind: e.kind }
}
