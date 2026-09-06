/**
 * Bilibili subtitle-track selection and body parsing (plan 2026-09-06 M2).
 *
 * Track priority is field-proven in the reference implementation:
 * manual zh > AI zh (ai-zh) > any zh > first non-empty. Track objects come
 * from `x/player/wbi/v2` `data.subtitle.subtitles[]`; the body is the
 * already-signed subtitle_url JSON `{body:[{from,to,content}]}` whose
 * from/to seconds map 1:1 onto the transcripts segments shape.
 */

export interface BiliSubtitleEntry {
  lan?: string
  lan_doc?: string
  ai_type?: number
  subtitle_url?: string
}

export interface BiliSubtitleSegment {
  from: number
  to: number
  content: string
}

export function isChineseTrack(entry: BiliSubtitleEntry): boolean {
  const lan = (entry.lan ?? '').toLowerCase()
  return lan.startsWith('zh') || lan === 'ai-zh'
}

export function isManualTrack(entry: BiliSubtitleEntry): boolean {
  return !entry.ai_type
}

/** Priority: manual zh > AI zh > any zh > first track. */
export function pickSubtitleTrack(subtitles: BiliSubtitleEntry[]): BiliSubtitleEntry | null {
  if (subtitles.length === 0) return null
  return (
    subtitles.find((s) => isChineseTrack(s) && isManualTrack(s)) ??
    subtitles.find((s) => isChineseTrack(s)) ??
    subtitles[0]
  )
}

/** Track URLs are protocol-relative (`//aisubtitle.hdslb.com/...`). */
export function normalizeSubtitleUrl(url: string): string {
  return url.startsWith('//') ? `https:${url}` : url
}

/** subtitle file JSON → segments; empty contents are dropped, order preserved. */
export function parseSubtitleBody(payload: unknown): BiliSubtitleSegment[] {
  const body = (payload as { body?: unknown })?.body
  if (!Array.isArray(body)) return []
  const segments: BiliSubtitleSegment[] = []
  for (const item of body) {
    if (item == null || typeof item !== 'object') continue
    const from = (item as { from?: unknown }).from
    const to = (item as { to?: unknown }).to
    const content = (item as { content?: unknown }).content
    const text = typeof content === 'string' ? content.trim() : ''
    if (text === '' || typeof from !== 'number' || typeof to !== 'number') continue
    segments.push({ from, to, content: text })
  }
  return segments
}

/** Segments → the transcripts.segments_json shape (`{at, text}` seconds). */
export function segmentsToTranscriptJson(segments: BiliSubtitleSegment[]): string {
  return JSON.stringify(segments.map((s) => ({ at: Math.round(s.from), text: s.content })))
}
