import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { extractWbiKeys, getMixinKey, signedPlayUrlParams, wbiSign } from '../src/main/bilibili/wbi'
import { buildDmImgParams } from '../src/main/bilibili/dm-params'

// Hand-computed vector (independent implementation, see commit notes):
// mixinKey over imgKey+subKey via the fixed permutation table, then
// md5("bar=514&foo=114&wts=1702204169" + mixinKey).
const IMG_KEY = 'abcdef0123456789abcdef0123456789'
const SUB_KEY = 'fedcba9876543210fedcba9876543210'
const WTS = 1702204169

describe('wbi signing', () => {
  it('derives the 32-char mixin key through the fixed permutation table', () => {
    // First table indices select chars 46,47,18,2,53,8,… of imgKey+subKey.
    const expected = getMixinKey(IMG_KEY + SUB_KEY)
    expect(expected).toBe('10cca21f9d495d2c54fee35d76886967')
    expect(expected).toHaveLength(32)
  })

  it('signs deterministically and matches the independent vector', () => {
    const signed = wbiSign({ foo: '114', bar: '514' }, { imgKey: IMG_KEY, subKey: SUB_KEY }, WTS)
    expect(signed.wts).toBe('1702204169')
    expect(signed.w_rid).toBe('27323ceaabc37738b3871387b9ddd186')
    expect(signed.bar).toBe('514')
    expect(signed.foo).toBe('114')
  })

  it('is stable for identical inputs and changes with the timestamp', () => {
    const a = wbiSign({ foo: '1' }, { imgKey: IMG_KEY, subKey: SUB_KEY }, WTS)
    const b = wbiSign({ foo: '1' }, { imgKey: IMG_KEY, subKey: SUB_KEY }, WTS)
    const c = wbiSign({ foo: '1' }, { imgKey: IMG_KEY, subKey: SUB_KEY }, WTS + 1)
    expect(a.w_rid).toBe(b.w_rid)
    expect(a.w_rid).not.toBe(c.w_rid)
  })

  it('strips the "!\u0027()*" characters from values before signing', () => {
    const signed = wbiSign({ v: "a!b'c(d)e*f" }, { imgKey: IMG_KEY, subKey: SUB_KEY }, WTS)
    expect(signed.v).toBe('abcdef')
    // The digest must be md5 over the sanitized query — recompute it here.
    const query = `v=abcdef&wts=${WTS}`
    const expected = createHash('md5').update(query + getMixinKey(IMG_KEY + SUB_KEY)).digest('hex')
    expect(signed.w_rid).toBe(expected)
  })
})

describe('wbi keys extraction', () => {
  it('reads the keys from the nav payload file names', () => {
    const payload = {
      code: -101,
      data: {
        wbi_img: {
          img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
          sub_url: 'https://i0.hdslb.com/bfs/wbi/4932ccb017c6b7161a3807dd265b19b2.png'
        }
      }
    }
    expect(extractWbiKeys(payload)).toEqual({
      imgKey: '7cd084941338484aae1ad9425b84077c',
      subKey: '4932ccb017c6b7161a3807dd265b19b2'
    })
  })

  it('returns null when the payload is unusable', () => {
    expect(extractWbiKeys({})).toBeNull()
    expect(extractWbiKeys({ data: { wbi_img: {} } })).toBeNull()
  })
})

describe('signed playurl params', () => {
  it('merges the dm_img risk-control fingerprints before signing', () => {
    const dm = buildDmImgParams(() => 'seed-with-a-stable-length-32-bytes!!')
    const signed = signedPlayUrlParams({ bvid: 'BV1GJ411x7h7' }, { imgKey: IMG_KEY, subKey: SUB_KEY }, dm, WTS)
    expect(signed.dm_img_list).toBe('[]')
    expect(signed.web_location).toBe('1550101')
    expect(signed.dm_img_inter).toContain('ds')
    expect(signed.w_rid).toMatch(/^[0-9a-f]{32}$/)
  })

  it('builds well-formed dm_img params', () => {
    const dm = buildDmImgParams()
    expect(dm.dm_img_list).toBe('[]')
    expect(dm.web_location).toBe('1550101')
    expect(dm.dm_img_str).not.toContain('=')
    expect(dm.dm_cover_img_str.length).toBeGreaterThan(10)
  })
})
