/**
 * Cookie-jar seeding for in-window platform navigations (review 2026-09-05
 * A5). Extracted from app-context so the jar contract is unit-testable.
 *
 * Cookies are always set httpOnly: the harvest merges `cookies.get` output
 * where the original HttpOnly flag is lost, and a session cookie readable
 * from page JS (document.cookie) is exactly the XSS exfiltration path the
 * red line forbids. The platform SPA authenticates via sessionStorage JWT,
 * not page-readable cookies, so marking every injected cookie HttpOnly is
 * safe; the API client sends credentials as headers regardless.
 */

/** Minimal shape of Electron's cookies API used here. */
export interface CookieJarLike {
  set(options: {
    url: string
    domain?: string
    name: string
    value: string
    secure?: boolean
    path?: string
    httpOnly?: boolean
  }): Promise<unknown>
}

/** Number of cookies actually set (skipped pairs excluded) — for logs only. */
export async function injectSessionCookiesIntoJar(jar: CookieJarLike, cookieString: string, url: string): Promise<number> {
  if (cookieString === '') return 0
  let injected = 0
  for (const pair of cookieString.split(';')) {
    const trimmed = pair.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    try {
      // Domain .seu.edu.cn so the SSO host (auth.seu.edu.cn) sees the
      // ticket cookies during the play-page redirect chain.
      await jar.set({
        url,
        domain: '.seu.edu.cn',
        name: trimmed.slice(0, eq),
        value: trimmed.slice(eq + 1),
        secure: true,
        path: '/',
        httpOnly: true
      })
      injected++
    } catch {
      // A single rejected cookie must not block the harvest.
    }
  }
  return injected
}
