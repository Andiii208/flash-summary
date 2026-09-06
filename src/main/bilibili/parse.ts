/**
 * Bilibili API payload parsing — pure functions over `unknown` JSON
 * (plan 2026-09-06 M2). Keeping these out of the client lets fixtures be
 * replayed in tests without any HTTP.
 */
import type { BiliSubtitleEntry } from './subtitle'

export interface BiliPageInfo {
  page: number
  cid: number
  part: string
  duration: number
}

export interface BiliViewInfo {
  bvid: string
  title: string
  /** Uploader mid — feeds the conclusion API (unused in MVP) and logs. */
  upMid: number | null
  coverUrl: string
  pages: BiliPageInfo[]
  /** Paid/charged-exclusive videos are rejected before any download. */
  paid: boolean
}

export interface BiliPlayerInfo {
  subtitles: BiliSubtitleEntry[]
  needLoginSubtitle: boolean
  paid: boolean
}

/** Guard shared by both payloads: charged-exclusive / paid videos are out of scope. */
function readPaidFlag(viewPayload: unknown, playerPayload?: unknown): boolean {
  if (playerPayload !== undefined) {
    const playerData = (playerPayload as { data?: Record<string, unknown> }).data
    if (playerData?.['is_upower_exclusive'] === true) return true
    if (playerData?.['is_ugc_pay_preview'] === true) return true
  }
  const rights = (viewPayload as { data?: { rights?: Record<string, unknown> } }).data?.rights
  return rights != null && (rights['is_ugc_pay'] === 1 || rights['is_upower_exclusive'] === 1)
}

export function parseViewInfo(payload: unknown): BiliViewInfo | null {
  const data = (payload as { data?: Record<string, unknown> }).data
  if (data == null || typeof data !== 'object') return null
  const bvid = data['bvid']
  const title = data['title']
  if (typeof bvid !== 'string' || typeof title !== 'string') return null
  const rawPages = Array.isArray(data['pages']) && data['pages'].length > 0 ? data['pages'] : [data]
  const pages: BiliPageInfo[] = []
  for (const raw of rawPages) {
    const parsed = parsePage(raw)
    if (parsed != null) pages.push(parsed)
  }
  if (pages.length === 0) return null
  const upMid = (data['owner'] as { mid?: unknown } | undefined)?.mid
  return {
    bvid,
    title,
    upMid: typeof upMid === 'number' ? upMid : null,
    coverUrl: typeof data['pic'] === 'string' ? data['pic'] : '',
    pages,
    paid: readPaidFlag(payload)
  }
}

function parsePage(raw: unknown): BiliPageInfo | null {
  if (raw == null || typeof raw !== 'object') return null
  const cid = (raw as { cid?: unknown }).cid
  if (typeof cid !== 'number') return null
  const page = (raw as { page?: unknown }).page
  const duration = (raw as { duration?: unknown }).duration
  return {
    page: typeof page === 'number' ? page : 1,
    cid,
    part: typeof (raw as { part?: unknown }).part === 'string' ? (raw as { part: string }).part : '',
    duration: typeof duration === 'number' ? duration : 0
  }
}

export function parsePlayerInfo(payload: unknown): BiliPlayerInfo | null {
  const data = (payload as { data?: Record<string, unknown> }).data
  if (data == null || typeof data !== 'object') return null
  const subtitle = data['subtitle'] as { subtitles?: unknown } | undefined
  const subtitles: BiliSubtitleEntry[] = Array.isArray(subtitle?.subtitles)
    ? (subtitle?.subtitles as BiliSubtitleEntry[]).filter((s) => s != null && typeof s === 'object')
    : []
  return {
    subtitles,
    needLoginSubtitle: data['need_login_subtitle'] === true,
    paid: readPaidFlag(payload, payload)
  }
}

export interface BiliDashStream {
  id: number
  baseUrl: string
  codecs: string
  bandwidth: number
}

export interface BiliDashStreams {
  videos: BiliDashStream[]
  audios: BiliDashStream[]
  /** Direct single-file stream (durl) when DASH is absent. */
  durl: string | null
  quality: number | null
}

/** playurl payload → DASH stream candidates (video+audio separated). */
export function parseDashStreams(payload: unknown): BiliDashStreams | null {
  const data = (payload as { data?: Record<string, unknown> }).data
  if (data == null || typeof data !== 'object') return null
  const dash = data['dash'] as { video?: unknown; audio?: unknown } | undefined
  const videos = readStreamList(dash?.video)
  const audios = readStreamList(dash?.audio)
  const durl = readDurl(data['durl'])
  if (videos.length === 0 && audios.length === 0 && durl == null) return null
  return { videos, audios, durl, quality: typeof data['quality'] === 'number' ? data['quality'] : null }
}

function readStreamList(raw: unknown): BiliDashStream[] {
  if (!Array.isArray(raw)) return []
  const streams: BiliDashStream[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    const baseUrl = (item as { baseUrl?: unknown; base_url?: unknown }).baseUrl ?? (item as { base_url?: unknown }).base_url
    if (typeof id !== 'number' || typeof baseUrl !== 'string' || baseUrl === '') continue
    streams.push({
      id,
      baseUrl,
      codecs: typeof (item as { codecs?: unknown }).codecs === 'string' ? (item as { codecs: string }).codecs : '',
      bandwidth: typeof (item as { bandwidth?: unknown }).bandwidth === 'number' ? (item as { bandwidth: number }).bandwidth : 0
    })
  }
  return streams
}

function readDurl(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const first = raw[0] as { url?: unknown } | null
  return typeof first?.url === 'string' ? first.url : null
}
