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

/** Promisified execFile with args; rejects with combined stderr on failure. */
export function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err != null) {
        reject(new Error(`ffmpeg command failed: ${String(stderr).slice(-2000) || err.message}`))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
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
  basename = 'teacher-audio'
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
  ])
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
  ffmpeg?: string
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
  ])
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
