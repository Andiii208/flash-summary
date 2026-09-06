import { describe, expect, it } from 'vitest'
import { BilibiliClient } from '../src/main/bilibili/client'
import { parseDashStreams, parsePlayerInfo, parseViewInfo } from '../src/main/bilibili/parse'
import { normalizeSubtitleUrl, pickSubtitleTrack, segmentsToTranscriptJson } from '../src/main/bilibili/subtitle'
import type { BiliSubtitleEntry } from '../src/main/bilibili/subtitle'

const API = 'https://api.bilibili.com'

interface FakeResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  url: string
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function jsonResponse(body: unknown, status = 200, url = 'https://api.bilibili.com/ok', headers: Record<string, string> = {}): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    url,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

function makeFetch(
  routes: Record<string, FakeResponse | RegExp>,
  capture?: { urls: string[]; headers: Record<string, string>[] }
) {
  return async (url: string, init?: { headers?: Record<string, string>; redirect?: string }) => {
    if (capture != null) {
      capture.urls.push(url)
      capture.headers.push(init?.headers ?? {})
    }
    let hit: FakeResponse | undefined
    for (const [key, response] of Object.entries(routes)) {
      if (key === url || (key.startsWith('/') && new RegExp(key.slice(1, key.lastIndexOf('/'))).test(url))) {
        hit = response as FakeResponse
        break
      }
    }
    if (hit == null) throw new Error(`no fixture route for ${url}`)
    return hit
  }
}

const NAV_PAYLOAD = {
  code: -101,
  data: {
    wbi_img: {
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932ccb017c6b7161a3807dd265b19b2.png'
    }
  }
}

const VIEW_PAYLOAD = {
  code: 0,
  data: {
    bvid: 'BV1GJ411x7h7',
    aid: 80433022,
    title: '【官方 MV】Never Gonna Give You Up',
    pic: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
    cid: 137649199,
    duration: 213,
    rights: { is_ugc_pay: 0 },
    owner: { mid: 486906719 },
    pages: [
      { page: 1, cid: 137649199, part: '正片', duration: 213 },
      { page: 2, cid: 137649200, part: '花絮', duration: 60 }
    ]
  }
}

function makeClient(fetchImpl: ReturnType<typeof makeFetch>, cookie = 'SESSDATA=abc') {
  return new BilibiliClient(async () => cookie, fetchImpl)
}

describe('BilibiliClient (fixture replay)', () => {
  it('viewInfo parses metadata without any cookie', async () => {
    const capture: { urls: string[]; headers: Record<string, string>[] } = { urls: [], headers: [] }
    const client = makeClient(makeFetch({ [`${API}/x/web-interface/view?bvid=BV1GJ411x7h7`]: jsonResponse(VIEW_PAYLOAD) }, capture))
    const info = await client.viewInfo('BV1GJ411x7h7')
    expect(info.title).toContain('Never Gonna Give You Up')
    expect(info.pages).toHaveLength(2)
    expect(info.pages[1]).toEqual({ page: 2, cid: 137649200, part: '花絮', duration: 60 })
    expect(info.upMid).toBe(486906719)
    expect(info.paid).toBe(false)
    expect(capture.headers[0]?.Cookie).toBeUndefined()
  })

  it('subtitleTracks requires a login to return tracks (need_login_subtitle)', async () => {
    const clientUrl = `${API}/x/player/wbi/v2?bvid=BV1GJ411x7h7&cid=137649199`
    const capture: { urls: string[]; headers: Record<string, string>[] } = { urls: [], headers: [] }
    const client = makeClient(
      makeFetch(
        {
          [clientUrl]: jsonResponse({
            code: 0,
            data: { need_login_subtitle: true, subtitle: { subtitles: [] } }
          })
        },
        capture
      ),
      'SESSDATA=abc'
    )
    const res = await client.subtitleTracks('BV1GJ411x7h7', 137649199)
    expect(res.subtitles).toEqual([])
    expect(res.needLoginSubtitle).toBe(true)
    expect(capture.headers[0]?.Cookie).toBe('SESSDATA=abc')
  })

  it('subtitleTracks surfaces -101 as auth_required', async () => {
    const clientUrl = `${API}/x/player/wbi/v2?bvid=BV1GJ411x7h7&cid=137649199`
    const client = makeClient(makeFetch({ [clientUrl]: jsonResponse({ code: -101, message: '账号未登录' }) }))
    await expect(client.subtitleTracks('BV1GJ411x7h7', 137649199)).rejects.toMatchObject({ kind: 'auth_required' })
  })

  it('dashStreams signs with wbi + dm_img params and carries the cookie', async () => {
    const capture: { urls: string[]; headers: Record<string, string>[] } = { urls: [], headers: [] }
    const client = makeClient(makeFetch({ [NAV_URL]: jsonResponse(NAV_PAYLOAD), '/playurl/': jsonResponse(PLAYURL_PAYLOAD) }, capture))
    const streams = await client.dashStreams('BV1GJ411x7h7', 137649199)
    const playurlUrl = capture.urls.find((u) => u.includes('playurl')) ?? ''
    const urlObj = new URL(playurlUrl)
    expect(urlObj.searchParams.get('w_rid')).toMatch(/^[0-9a-f]{32}$/)
    expect(urlObj.searchParams.get('wts')).toMatch(/^\d+$/)
    expect(urlObj.searchParams.get('dm_img_list')).toBe('[]')
    expect(urlObj.searchParams.get('qn')).toBe('32')
    expect(urlObj.searchParams.get('fnval')).toBe('16')
    expect(capture.headers.at(-1)?.Cookie).toBe('SESSDATA=abc')
    expect(streams.audios.length).toBeGreaterThan(0)
    expect(streams.videos.length).toBeGreaterThan(0)
  })

  it('maps HTTP 412 onto risk_control', async () => {
    const client = makeClient(
      makeFetch({
        [NAV_URL]: jsonResponse(NAV_PAYLOAD),
        '/playurl/': jsonResponse({ code: 0, data: {} }, 412)
      })
    )
    await expect(client.dashStreams('BV1GJ411x7h7', 137649199)).rejects.toMatchObject({ kind: 'risk_control' })
  })

  it('fetchSubtitleBody reads the bare-JSON subtitle file', async () => {
    const subtitleUrl = '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1.json'
    const client = makeClient(
      makeFetch({
        [`https:${subtitleUrl}`]: jsonResponse({ body: [{ from: 0.5, to: 2.4, content: ' 大家好 ' }, { from: 2.4, to: 4, content: '今天讲极限' }, { from: 4, to: 5, content: '' }] })
      })
    )
    const segments = await client.fetchSubtitleBody(subtitleUrl)
    expect(segments).toEqual([
      { from: 0.5, to: 2.4, content: '大家好' },
      { from: 2.4, to: 4, content: '今天讲极限' }
    ])
  })

  it('resolveShortLink follows the redirect location', async () => {
    const client = makeClient(
      makeFetch({
        'https://b23.tv/abc123': jsonResponse({}, 302, 'https://b23.tv/abc123', { location: 'https://www.bilibili.com/video/BV1GJ411x7h7?p=2' })
      })
    )
    const resolved = await client.resolveShortLink('https://b23.tv/abc123')
    expect(resolved).toBe('https://www.bilibili.com/video/BV1GJ411x7h7?p=2')
  })

  it('rejects paid content through the view payload flag', () => {
    const paid = parseViewInfo({ code: 0, data: { ...VIEW_PAYLOAD.data, rights: { is_ugc_pay: 1 } } })
    expect(paid?.paid).toBe(true)
    const exclusive = parsePlayerInfo({ code: 0, data: { is_upower_exclusive: true, subtitle: { subtitles: [] } } })
    expect(exclusive?.paid).toBe(true)
  })
})

const NAV_URL = `${API}/x/web-interface/nav`
const PLAYURL_PAYLOAD = {
  code: 0,
  data: {
    quality: 32,
    dash: {
      video: [
        { id: 32, baseUrl: 'https://xy.mcdn.bilivideo.cn:8082/v1', base_url: 'https://xy.mcdn.bilivideo.cn:8082/v1', codecs: 'avc1.640800', bandwidth: 800000 },
        { id: 16, baseUrl: 'https://xy.mcdn.bilivideo.cn:8082/v0', codecs: 'avc1.640800', bandwidth: 300000 }
      ],
      audio: [
        { id: 30216, baseUrl: 'https://xy.mcdn.bilivideo.cn:8082/a1', codecs: 'mp4a.40.5', bandwidth: 64000 },
        { id: 30280, baseUrl: 'https://xy.mcdn.bilivideo.cn:8082/a2', codecs: 'mp4a.40.2', bandwidth: 132000 }
      ]
    }
  }
}

describe('parse helpers', () => {
  it('parseDashStreams keeps both baseUrl spellings and the durl fallback', () => {
    const streams = parseDashStreams(PLAYURL_PAYLOAD)
    expect(streams?.videos[0]).toEqual({ id: 32, baseUrl: 'https://xy.mcdn.bilivideo.cn:8082/v1', codecs: 'avc1.640800', bandwidth: 800000 })
    expect(streams?.quality).toBe(32)
    const durl = parseDashStreams({ code: 0, data: { quality: 16, durl: [{ url: 'https://cdn.example.com/f.mp4' }] } })
    expect(durl?.durl).toBe('https://cdn.example.com/f.mp4')
    expect(parseDashStreams({ code: 0, data: {} })).toBeNull()
  })

  it('pickSubtitleTrack prefers manual zh over AI zh over anything', () => {
    const tracks: BiliSubtitleEntry[] = [
      { lan: 'en-US', ai_type: 0, subtitle_url: '//x/en.json' },
      { lan: 'ai-zh', ai_type: 1, subtitle_url: '//x/ai.json' },
      { lan: 'zh-CN', ai_type: 0, subtitle_url: '//x/manual.json' }
    ]
    expect(pickSubtitleTrack(tracks)?.subtitle_url).toBe('//x/manual.json')
    expect(pickSubtitleTrack([tracks[0], tracks[1]])?.subtitle_url).toBe('//x/ai.json')
    expect(pickSubtitleTrack([tracks[0]])?.subtitle_url).toBe('//x/en.json')
    expect(pickSubtitleTrack([])).toBeNull()
  })

  it('subtitle segments convert to the transcripts json shape', () => {
    const json = segmentsToTranscriptJson([
      { from: 0.5, to: 2.4, content: '大家好' },
      { from: 2.4, to: 4, content: '今天讲极限' }
    ])
    expect(JSON.parse(json)).toEqual([
      { at: 1, text: '大家好' },
      { at: 2, text: '今天讲极限' }
    ])
    expect(normalizeSubtitleUrl('//x/y.json')).toBe('https://x/y.json')
  })
})
