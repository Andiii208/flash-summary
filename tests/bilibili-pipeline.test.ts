import { describe, expect, it } from 'vitest'
import { fetchBilibiliLesson, pickAudioStream, pickPage, pickVideoStream, BilibiliPaidError } from '../src/main/bilibili/pipeline'
import { BilibiliApiError, BilibiliClient, type FetchLike } from '../src/main/bilibili/client'
import type { BiliViewInfo } from '../src/main/bilibili/parse'

const API = 'https://api.bilibili.com'

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    url: 'https://api.bilibili.com/fake',
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

const VIEW_PAYLOAD = {
  code: 0,
  data: {
    bvid: 'BV1TEST0000',
    title: '线性代数全集',
    pic: 'https://i0.hdslb.com/cover.jpg',
    cid: 1001,
    duration: 300,
    rights: { is_ugc_pay: 0 },
    owner: { mid: 42 },
    pages: [
      { page: 1, cid: 1001, part: 'P1 行列式', duration: 300 },
      { page: 2, cid: 1002, part: 'P2 矩阵', duration: 420 }
    ]
  }
}

const PLAYER_WITH_SUBTITLE = {
  code: 0,
  data: {
    need_login_subtitle: true,
    subtitle: {
      subtitles: [{ lan: 'ai-zh', ai_type: 1, subtitle_url: '//aisubtitle.hdslb.com/bfs/x.json' }]
    }
  }
}

const SUBTITLE_BODY = { body: [{ from: 0.2, to: 3, content: '大家好' }, { from: 3, to: 6.4, content: '今天讲行列式' }] }

const NAV_PAYLOAD = {
  code: -101,
  data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/a1.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/b2.png' } }
}

function makeClient(fetchImpl: FetchLike): BilibiliClient {
  return new BilibiliClient(async () => 'SESSDATA=x', fetchImpl)
}

/** Exact-match routes plus a playurl override (its signed query is unpredictable). */
function makeFetch(routes: Record<string, unknown>, playurlOverride?: (url: string) => unknown): FetchLike {
  return async (url) => {
    if (url.includes('/x/player/wbi/playurl')) {
      if (playurlOverride != null) {
        const hit = playurlOverride(url)
        if (typeof hit === 'number') return jsonRes({}, hit)
        return jsonRes(hit)
      }
      throw new Error(`no fixture route for ${url}`)
    }
    const hit = routes[url]
    if (hit === undefined) throw new Error(`no fixture route for ${url}`)
    return jsonRes(hit)
  }
}

const PLAYURL_PAYLOAD = {
  code: 0,
  data: {
    quality: 32,
    dash: {
      video: [
        { id: 80, baseUrl: 'https://cdn/v1080', codecs: 'avc1', bandwidth: 2000000 },
        { id: 32, baseUrl: 'https://cdn/v480', codecs: 'avc1', bandwidth: 800000 }
      ],
      audio: [
        { id: 30280, baseUrl: 'https://cdn/a132', codecs: 'mp4a', bandwidth: 132000 },
        { id: 30216, baseUrl: 'https://cdn/a64', codecs: 'mp4a', bandwidth: 64000 }
      ]
    }
  }
}

const BASE_ROUTES: Record<string, unknown> = {
  [`${API}/x/web-interface/view?bvid=BV1TEST0000`]: VIEW_PAYLOAD,
  [`${API}/x/player/wbi/v2?bvid=BV1TEST0000&cid=1001`]: PLAYER_WITH_SUBTITLE,
  'https://aisubtitle.hdslb.com/bfs/x.json': SUBTITLE_BODY,
  [`${API}/x/web-interface/nav`]: NAV_PAYLOAD
}

describe('fetchBilibiliLesson (plan 2026-09-06 M4)', () => {
  it('subtitle fast path: segments + 480P video, no audio when subtitle exists', async () => {
    const seen: string[] = []
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url)
      return makeFetch(BASE_ROUTES, () => PLAYURL_PAYLOAD)(url)
    }
    const result = await fetchBilibiliLesson(makeClient(fetchImpl), 'BV1TEST0000', 1)
    expect(result.segments).toEqual([
      { at: 0, text: '大家好' },
      { at: 3, text: '今天讲行列式' }
    ])
    expect(result.videoStreamUrl).toBe('https://cdn/v480')
    expect(result.audioStreamUrl).toBeNull()
    expect(result.title).toBe('P1 行列式')
    expect(result.durationSeconds).toBe(300)
    expect(result.note).toContain('AI字幕')
    expect(seen.some((u) => u.includes('aisubtitle'))).toBe(true)
  })

  it('no subtitle → picks the lowest-bandwidth audio too (ASR fallback)', async () => {
    const routes: Record<string, unknown> = {
      ...BASE_ROUTES,
      [`${API}/x/player/wbi/v2?bvid=BV1TEST0000&cid=1001`]: { code: 0, data: { need_login_subtitle: true, subtitle: { subtitles: [] } } }
    }
    const result = await fetchBilibiliLesson(makeClient(makeFetch(routes, () => PLAYURL_PAYLOAD)), 'BV1TEST0000', 1)
    expect(result.segments).toEqual([])
    expect(result.audioStreamUrl).toBe('https://cdn/a64')
    expect(result.videoStreamUrl).toBe('https://cdn/v480')
    expect(result.note).toContain('没有可用字幕')
  })

  it('refuses paid content outright (compliance red line)', async () => {
    const routes: Record<string, unknown> = {
      ...BASE_ROUTES,
      [`${API}/x/web-interface/view?bvid=BV1TEST0000`]: { code: 0, data: { ...VIEW_PAYLOAD.data, rights: { is_ugc_pay: 1 } } }
    }
    await expect(fetchBilibiliLesson(makeClient(makeFetch(routes)), 'BV1TEST0000', 1)).rejects.toBeInstanceOf(BilibiliPaidError)
  })

  it('risk-controlled playurl with a subtitle present: degrade to no keyframes', async () => {
    const result = await fetchBilibiliLesson(makeClient(makeFetch(BASE_ROUTES, () => 412)), 'BV1TEST0000', 1)
    expect(result.segments.length).toBeGreaterThan(0)
    expect(result.videoStreamUrl).toBeNull()
    expect(result.note).toContain('风控')
  })

  it('risk-controlled playurl without a subtitle: hard failure (nothing to do)', async () => {
    const routes: Record<string, unknown> = {
      ...BASE_ROUTES,
      [`${API}/x/player/wbi/v2?bvid=BV1TEST0000&cid=1001`]: { code: 0, data: { need_login_subtitle: true, subtitle: { subtitles: [] } } }
    }
    await expect(fetchBilibiliLesson(makeClient(makeFetch(routes, () => 412)), 'BV1TEST0000', 1)).rejects.toBeInstanceOf(BilibiliApiError)
  })

  it('stream/ page pickers and page fallback', () => {
    const view = VIEW_PAYLOAD.data as unknown as BiliViewInfo
    expect(pickPage(view, 2).cid).toBe(1002)
    expect(pickPage(view, 99).cid).toBe(1001)
    expect(pickVideoStream([{ id: 80, baseUrl: 'a' }, { id: 32, baseUrl: 'b' }])).toBe('b')
    expect(pickVideoStream([{ id: 80, baseUrl: 'a' }])).toBe('a')
    expect(pickAudioStream([{ bandwidth: 2, baseUrl: 'hi' }, { bandwidth: 1, baseUrl: 'lo' }])).toBe('lo')
  })
})
