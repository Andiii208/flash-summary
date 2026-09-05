import { describe, expect, it } from 'vitest'
import { injectSessionCookiesIntoJar, type CookieJarLike } from '../src/main/auth/cookie-inject'

describe('injectSessionCookiesIntoJar (review A5: HttpOnly preserved)', () => {
  it('sets every harvested cookie with httpOnly=true, secure, and the .seu.edu.cn domain', async () => {
    const seen: Array<Record<string, unknown>> = []
    const jar: CookieJarLike = {
      set: async (options) => {
        seen.push(options as Record<string, unknown>)
        return undefined
      }
    }
    const injected = await injectSessionCookiesIntoJar(
      jar,
      'JSESSIONID=abc123; CASTGT=ticket-xyz',
      'https://cvs.seu.edu.cn'
    )
    expect(injected).toBe(2)
    expect(seen).toHaveLength(2)
    for (const options of seen) {
      expect(options.httpOnly).toBe(true)
      expect(options.secure).toBe(true)
      expect(options.domain).toBe('.seu.edu.cn')
      expect(options.path).toBe('/')
    }
    expect(seen[0]).toMatchObject({ name: 'JSESSIONID', value: 'abc123' })
    expect(seen[1]).toMatchObject({ name: 'CASTGT', value: 'ticket-xyz' })
  })

  it('skips malformed pairs but keeps going (one rejection must not block the harvest)', async () => {
    const seen: string[] = []
    const jar: CookieJarLike = {
      set: async (options) => {
        if (options.name === 'BAD') throw new Error('rejected')
        seen.push(`${options.name}=${options.value}`)
        return undefined
      }
    }
    const injected = await injectSessionCookiesIntoJar(jar, '=novalue; BAD=x; GOOD=y', 'https://cvs.seu.edu.cn')
    expect(seen).toEqual(['GOOD=y'])
    expect(injected).toBe(1)
  })

  it('returns 0 for an empty cookie string without touching the jar', async () => {
    let calls = 0
    const jar: CookieJarLike = {
      set: async () => {
        calls++
        return undefined
      }
    }
    expect(await injectSessionCookiesIntoJar(jar, '', 'https://cvs.seu.edu.cn')).toBe(0)
    expect(calls).toBe(0)
  })
})
