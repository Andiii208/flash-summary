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
  await run(ffmpeg ?? requireBin('ffmpeg'), [
    '-y',
    '-i', videoPath,
    '-vf', `fps=1/${everySeconds}`,
    '-q:v', '2',
    pattern
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
