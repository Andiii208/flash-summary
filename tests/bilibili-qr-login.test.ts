import { describe, expect, it } from 'vitest'
import { cookiesFromCrossDomainUrl, parseQrGenerate, qrStatusFromCode } from '../src/main/bilibili/qr-login'

describe('qr login helpers (M3)', () => {
  it('parseQrGenerate reads the QR content url and the polling key', () => {
    expect(
      parseQrGenerate({ code: 0, data: { url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=QR1', qrcode_key: 'QR1' } })
    ).toEqual({ qrUrl: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=QR1', qrcodeKey: 'QR1' })
    expect(parseQrGenerate({ code: 0, data: {} })).toBeNull()
    expect(parseQrGenerate({})).toBeNull()
  })

  it('qrStatusFromCode maps the documented poll code set', () => {
    expect(qrStatusFromCode(86101)).toBe('waiting')
    expect(qrStatusFromCode(86090)).toBe('scanned')
    expect(qrStatusFromCode(86038)).toBe('expired')
    expect(qrStatusFromCode(0)).toBe('confirmed')
    expect(qrStatusFromCode(-1)).toBe('waiting')
  })

  it('cookiesFromCrossDomainUrl extracts SESSDATA/bili_jct/DedeUserID in order', () => {
    const cookies = cookiesFromCrossDomainUrl(
      'https://passport.biligame.com/crossDomain?DedeUserID=123&DedeUserID__ckMd5=hash&Expires=18000&SESSDATA=sess%2Fvalue&bili_jct=tok1&gourl=https%3A%2F%2Fpassport.bilibili.com'
    )
    expect(cookies).toBe('SESSDATA=sess/value; bili_jct=tok1; DedeUserID=123')
  })

  it('refuses a handoff without SESSDATA (the one cookie subtitles need)', () => {
    expect(cookiesFromCrossDomainUrl('https://passport.biligame.com/crossDomain?DedeUserID=1')).toBeNull()
    expect(cookiesFromCrossDomainUrl('')).toBeNull()
    expect(cookiesFromCrossDomainUrl('not a url')).toBeNull()
  })
})
