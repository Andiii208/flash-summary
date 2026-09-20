/**
 * Bilibili → pipeline handoff (plan 2026-09-06 M4).
 *
 * One lesson fetch resolves everything downloading_video needs:
 * metadata (title/duration), the CC/AI subtitle segments when available
 * (the «阿哔» fast path — no download, no ASR), and the DASH stream
 * candidates (360P video for keyframes, audio for the ASR fallback).
 * Paid/charged-exclusive videos are refused outright (compliance red
 * line). Signed stream URLs stay in-memory here and flow to the stage
 * output only — never into lessons rows or logs.
 */
import type { BilibiliClient, BilibiliApiError } from './client'
import { pickSubtitleTrack, segmentsToTranscriptJson, type BiliSubtitleSegment } from './subtitle'
import type { BiliViewInfo } from './parse'

export interface BilibiliFetchResult {
  title: string
  durationSeconds: number | null
  /** Non-empty → the subtitle fast path; transcripts are inserted by the orchestrator. */
  segments: Array<{ at: number; text: string }>
  segmentsJson: string
  /** DASH video stream (lowest allowed quality) for keyframe extraction. */
  videoStreamUrl: string | null
  /** DASH audio stream, only when there is no subtitle (ASR fallback). */
  audioStreamUrl: string | null
  /** Honest note for the logs/UI («未登录，走语音转写»). */
  note: string
}

export class BilibiliPaidError extends Error {
  constructor() {
    super('该视频为付费/充电专属内容，不支持导入（合规边界）')
    this.name = 'BilibiliPaidError'
  }
}

/** The page the URL pointed at, resolved against the video's page list. */
export function pickPage(view: BiliViewInfo, requestedPage: number): { cid: number; part: string; duration: number } {
  if (view.pages.length === 0) throw new Error('B站视频没有可用的分P信息')
  const target = view.pages.find((p) => p.page === requestedPage) ?? view.pages[0]
  return { cid: target.cid, part: target.part, duration: target.duration }
}

/** Lowest-quality video candidate: the plan caps B站 at ≤480P (qn 32). */
export function pickVideoStream(videos: Array<{ id: number; baseUrl: string }>): string | null {
  if (videos.length === 0) return null
  const sorted = [...videos].sort((a, b) => a.id - b.id)
  const capped = sorted.find((v) => v.id <= 32) ?? sorted[0]
  return capped.baseUrl
}

export function pickAudioStream(audios: Array<{ bandwidth: number; baseUrl: string }>): string | null {
  if (audios.length === 0) return null
  const sorted = [...audios].sort((a, b) => a.bandwidth - b.bandwidth)
  return sorted[0].baseUrl
}

/** Subtitle segments in the transcripts shape ({at, text}), or [] when none. */
async function tryFetchSubtitleSegments(client: BilibiliClient, bvid: string, cid: number): Promise<{ segments: BiliSubtitleSegment[]; note: string }> {
  try {
    const { subtitles } = await client.subtitleTracks(bvid, cid)
    const track = pickSubtitleTrack(subtitles)
    if (track?.subtitle_url == null) {
      return { segments: [], note: subtitles.length === 0 ? '该视频没有可用字幕轨' : '字幕轨缺少地址' }
    }
    const body = await client.fetchSubtitleBody(track.subtitle_url)
    return { segments: body, note: `使用B站${(track.lan ?? '').startsWith('ai') || track.lan === 'ai-zh' ? 'AI' : ''}字幕 (${track.lan ?? 'zh'})` }
  } catch (err) {
    const kind = (err as BilibiliApiError).kind
    if (kind === 'auth_required') return { segments: [], note: 'B站未登录或登录已过期，无字幕可用，将走语音转写' }
    if (kind === 'risk_control' || kind === 'forbidden') return { segments: [], note: '字幕接口被风控拒绝，将走语音转写' }
    throw err
  }
}

/**
 * Fetch one Bilibili P: metadata + subtitle segments + DASH stream picks.
 * Never logs and never persists stream URLs — the caller owns the handoff.
 */
export async function fetchBilibiliLesson(
  client: BilibiliClient,
  bvid: string,
  requestedPage: number,
  signal?: AbortSignal
): Promise<BilibiliFetchResult> {
  if (signal?.aborted) throw new Error('任务已取消')
  const view = await client.viewInfo(bvid)
  if (view.paid) throw new BilibiliPaidError()
  const page = pickPage(view, requestedPage)

  const { segments, note: subtitleNote } = await tryFetchSubtitleSegments(client, bvid, page.cid)
  let videoStreamUrl: string | null = null
  let audioStreamUrl: string | null = null
  let streamNote = ''
  try {
    const streams = await client.dashStreams(bvid, page.cid, signal)
    videoStreamUrl = pickVideoStream(streams.videos)
    // Audio is only worth downloading when ASR will run (no subtitle).
    if (segments.length === 0) audioStreamUrl = pickAudioStream(streams.audios)
    streamNote = videoStreamUrl == null ? '未取得视频流地址（可能风控拒绝），本轮无关键帧' : ''
  } catch (err) {
    const kind = (err as BilibiliApiError).kind
    streamNote = kind === 'risk_control' ? '视频流接口被风控拒绝（412），本轮无关键帧' : '视频流地址获取失败'
    if (segments.length === 0 && kind === 'risk_control') {
      // No subtitle AND no stream: nothing this run can do.
      throw err
    }
  }
  if (segments.length === 0 && audioStreamUrl == null && videoStreamUrl == null) {
    throw new Error('B站视频既无字幕也无可用流地址，无法处理')
  }

  const notes = [subtitleNote, streamNote].filter((n) => n !== '')
  return {
    title: view.pages.length > 1 && page.part !== '' ? page.part : view.title,
    durationSeconds: page.duration > 0 ? page.duration : null,
    segments: segments.map((s) => ({ at: Math.round(s.from), text: s.content })),
    segmentsJson: segmentsToTranscriptJson(segments),
    videoStreamUrl,
    audioStreamUrl,
    note: notes.join('；')
  }
}
