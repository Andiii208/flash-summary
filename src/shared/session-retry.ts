/**
 * Session-expiry retry rule (spec §2): when an IPC action fails with
 * kind === 'session_expired', the renderer re-opens the CAS login once and
 * retries the original action. Kept DOM-free so it is unit-testable.
 */
import type { ApiResult } from '../shared/api-result'

export type Relogin = () => Promise<ApiResult<unknown>>

export async function withSessionRetry<T>(
  action: () => Promise<ApiResult<T>>,
  relogin: Relogin
): Promise<ApiResult<T>> {
  const first = await action()
  if (first.ok) return first
  if (first.kind !== 'session_expired') return first
  const login = await relogin()
  if (!login.ok) return first
  return action()
}
