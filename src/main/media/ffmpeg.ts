/**
 * ffmpeg pipeline stages: audio extraction and keyframe extraction.
 *
 * Pure orchestration over child_process.execFile — the ffmpeg/ffprobe paths
 * are injectable so tests run the real bundled binaries against tiny
 * generated sample media without any network.
 */
import { execFile } from 'child_process'
import { statSync } from 'fs'
import { join } from 'path'
import { thumbPathFor, THUMB_SCALE_FILTER } from './grid'

export interface RunResult {
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Kill the process (and reject) after this many ms. */
  timeoutMs?: number
  /** Abort externally (task cancellation, U4). */
  signal?: AbortSignal
  /** Kill the process if this file's size stops growing within stallMs. */
  stallGuard?: { file: string; stallMs: number }
}

/**
 * Promisified execFile with args; rejects with combined stderr on failure.
 * Supports a wall-clock timeout and a "no progress" stall guard (U4): the
 * video stream download remuxes with `-c copy` and ffmpeg can hang on a
 * stalled campus-network stream — the guard kills it instead of hanging
 * the whole task forever.
 */
export function run(bin: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let stallTimer: NodeJS.Timeout | undefined
    const finish = (err: Error | null, stdout: string, stderr: string): void => {
      if (settled) return
      settled = true
      if (stallTimer != null) clearInterval(stallTimer)
      if (err != null) {
        const killedByTimeout = options.timeoutMs != null && (err as { killed?: boolean }).killed
        const reason = killedByTimeout ? `process timed out after ${options.timeoutMs}ms` : 'process failed'
        reject(new Error(`${reason}: ${String(stderr).slice(-2000) || err.message}`))
        return
      }
      resolve({ stdout, stderr })
    }

    const child = execFile(
      bin,
      args,
      {
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        timeout: options.timeoutMs,
        signal: options.signal
      },
      (err, stdout, stderr) => finish(err, String(stdout), String(stderr))
    )

    if (options.stallGuard != null) {
      let lastSize = safeSize(options.stallGuard.file)
      let lastGrow = Date.now()
      stallTimer = setInterval(() => {
        if (settled) return
        const size = safeSize(options.stallGuard?.file ?? '')
        if (size > lastSize) {
          lastSize = size
          lastGrow = Date.now()
        } else if (Date.now() - lastGrow > (options.stallGuard?.stallMs ?? 0)) {
          child.kill()
          finish(new Error('stalled: no output progress'), '', '')
        }
      }, 1000)
    }
  })
}

function safeSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

export interface AudioExtractionResult {
  audioPath: string
  durationSeconds: number
}

/**
 * Extract audio from the teacher stream video as 16 kHz mono WAV — the
 * format ASR providers accept most reliably. `videoPath` is temporary and
 * the caller deletes it after successful extraction (spec §7).
 */
export async function extractAudio(
  videoPath: string,
  outDir: string,
  ffmpeg?: string,
  basename = 'teacher-audio',
  signal?: AbortSignal
): Promise<AudioExtractionResult> {
  const audioPath = join(outDir, `${basename}.wav`)
  await run(ffmpeg ?? requireBin('ffmpeg'), [
    '-y',
    '-i', videoPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    audioPath
  ], {
    signal,
    // D7 (review): same guard set as the download remux — a hung ffmpeg
    // must not occupy the serial queue indefinitely.
    timeoutMs: 30 * 60 * 1000,
    stallGuard: { file: audioPath, stallMs: 60_000 }
  })
  const duration = await probeDuration(audioPath)
  return { audioPath, durationSeconds: duration }
}

export interface KeyframeResult {
  filePath: string
  timestampSeconds: number
}

/**
 * Extract keyframes from the screen/PPT stream at a fixed interval
 * (`everySeconds`), writing JPGs named by timestamp. Deduplication happens
 * later via perceptual hashing; this stage only produces candidates.
 *
 * 批3 (plan 2026-09-19 audit-remediation): 一次 spawn 双输出——全分辨率帧
 * 之外同出 64px 宽缩略图（高取 8 的倍数，令 8x8 网格边界与全分辨率严格
 * 对齐；保真门 `tests/media-thumb-fidelity.test.ts` 实测汉明 ≤1/64）。
 * 哈希改吃缩略图（`decodeGridPreferThumb`），主进程不再全分辨率解码；
 * 缩略图只服务 phash、不展示，summarize 装配完即删。
 */
export async function extractKeyframes(
  videoPath: string,
  outDir: string,
  everySeconds: number,
  ffmpeg?: string,
  signal?: AbortSignal
): Promise<KeyframeResult[]> {
  const { mkdirSync, readdirSync } = await import('fs')
  mkdirSync(outDir, { recursive: true })
  const pattern = join(outDir, 'frame-%04d.jpg')
  // thumbPathFor 单一事实源：命名 = thumbPathFor('frame-%04d.jpg') 的逐帧展开。
  const thumbPattern = thumbPathFor(pattern)
  await run(ffmpeg ?? requireBin('ffmpeg'), [
    '-y',
    '-i', videoPath,
    '-filter_complex',
    `[0:v]fps=1/${everySeconds},split[a][b];[b]${THUMB_SCALE_FILTER}[t]`,
    '-map', '[a]', '-q:v', '2', pattern,
    '-map', '[t]', '-q:v', '4', thumbPattern
  ], {
    signal,
    // D7 (review): a hard deadline only — the stall guard watches a single
    // file and the keyframe pattern rotates across many files.
    timeoutMs: 30 * 60 * 1000
  })
  const files = readdirSync(outDir)
    .filter((f) => /^frame-\d{4}\.jpg$/.test(f))
    .sort()
  return files.map((f, i) => ({
    filePath: join(outDir, f),
    timestampSeconds: i * everySeconds
  }))
}

/**
 * 浏览器 HTTP 头（Referer + UA）——B 站 CDN 对无 Referer 的请求回 403
 * （防盗链流），而 ffmpeg 自己不发 Referer。与 orchestrator 的
 * streamFetchArgs 同一份常量（单一事实源）。
 */
export const STREAM_HTTP_HEADERS =
  'Referer: https://www.bilibili.com/\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36\r\n'

/** keyframesFromUrlArgs 的纯参数构建（-headers 浏览器头 + -i URL + 双输出）。 */
export function keyframesFromUrlArgs(url: string, pattern: string, thumbPattern: string, everySeconds: number): string[] {
  return [
    '-y',
    '-headers',
    STREAM_HTTP_HEADERS,
    '-i',
    url,
    '-filter_complex',
    `[0:v]fps=1/${everySeconds},split[a][b];[b]${THUMB_SCALE_FILTER}[t]`,
    '-map', '[a]', '-q:v', '2', pattern,
    '-map', '[t]', '-q:v', '4', thumbPattern
  ]
}

/**
 * A3-② (plan 2026-09-19): 字幕快路径**免下载抽帧**——ffmpeg 直读流 URL
 * （ Referer 头见 STREAM_HTTP_HEADERS），省掉「为抽帧而下整片」的 3-8 分钟。
 * 与 extractKeyframes 同一 fps/双输出口径；**抽不到任何帧时抛错**，让调用方
 * 回落「下载后抽帧」旧路径（URL 时效/风控时保底）。
 */
export async function extractKeyframesFromUrl(
  url: string,
  outDir: string,
  everySeconds: number,
  ffmpeg?: string,
  signal?: AbortSignal
): Promise<KeyframeResult[]> {
  const { mkdirSync, readdirSync } = await import('fs')
  mkdirSync(outDir, { recursive: true })
  const pattern = join(outDir, 'frame-%04d.jpg')
  const thumbPattern = thumbPathFor(pattern)
  await run(ffmpeg ?? requireBin('ffmpeg'), keyframesFromUrlArgs(url, pattern, thumbPattern, everySeconds), {
    signal,
    timeoutMs: 30 * 60 * 1000
  })
  const files = readdirSync(outDir)
    .filter((f) => /^frame-\d{4}\.jpg$/.test(f))
    .sort()
  const results = files.map((f, i) => ({
    filePath: join(outDir, f),
    timestampSeconds: i * everySeconds
  }))
  if (results.length === 0) {
    throw new Error(`直读流 URL 未抽出任何帧（URL 可能已失效或被风控）：${url.slice(0, 80)}`)
  }
  return results
}

export interface MediaInfo {
  durationSeconds: number
  width: number
  height: number
}

/** ffprobe JSON inspection of a media file. */
export async function probeMedia(file: string, ffprobe?: string): Promise<MediaInfo> {
  const { stdout } = await run(ffprobe ?? requireBin('ffprobe'), [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file
  ])
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>
  }
  const video = parsed.streams?.find((s) => s.codec_type === 'video')
  const duration = Number(parsed.format?.duration ?? video?.duration ?? '0')
  return {
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0
  }
}

async function probeDuration(file: string): Promise<number> {
  const info = await probeMedia(file)
  return info.durationSeconds
}

/** True when the file contains at least one audio stream (ffprobe). */
export async function hasAudioStream(file: string, ffprobe?: string): Promise<boolean> {
  const { stdout } = await run(ffprobe ?? requireBin('ffprobe'), [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    file
  ])
  return stdout.trim() !== ''
}

/**
 * Pick the stream file that actually carries audio for the audio-extraction
 * stage. Platform field reality (2026-09-02): the teacher (camera) stream
 * often has NO audio track — the screen stream carries the classroom AAC —
 * so prefer the teacher stream per spec and fall back to the screen one.
 */
export async function pickAudioSource(
  teacherPath: string,
  screenPath: string,
  ffprobe?: string
): Promise<string> {
  if (await hasAudioStream(teacherPath, ffprobe)) return teacherPath
  if (await hasAudioStream(screenPath, ffprobe)) return screenPath
  throw new Error('教师流与屏幕流均不含音频轨，无法提取音频')
}

/** Lazy resolution of bundled binaries (avoids import-time coupling). */
function requireBin(which: 'ffmpeg' | 'ffprobe'): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (which === 'ffmpeg') return require('ffmpeg-static') as string
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('ffprobe-static') as { path: string }).path
}

/** File size helper used by lifecycle assertions (temporary files must vanish). */
export function fileSizeOrNull(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}
