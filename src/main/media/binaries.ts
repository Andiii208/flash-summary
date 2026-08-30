/**
 * Locates ffmpeg/ffprobe binaries.
 *
 * MVP decision (recorded in PROGRESS.md): bundle via ffmpeg-static /
 * ffprobe-static npm packages. Binaries live in node_modules in dev and are
 * packaged with the app in Phase 7 (electron-builder extraResources), so no
 * system-wide ffmpeg installation is required.
 */
import { existsSync } from 'fs'

function resolveFfmpegPath(): string {
  // electron-vite bundles main to CJS out/main/index.js; require stays intact.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegStatic = require('ffmpeg-static') as string | null
  if (typeof ffmpegStatic === 'string' && ffmpegStatic !== '' && existsSync(ffmpegStatic)) return ffmpegStatic
  throw new Error('ffmpeg binary not found (ffmpeg-static not installed?)')
}

function resolveFfprobePath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffprobeStatic = require('ffprobe-static') as { path: string }
  if (ffprobeStatic && typeof ffprobeStatic.path === 'string' && existsSync(ffprobeStatic.path)) return ffprobeStatic.path
  throw new Error('ffprobe binary not found (ffprobe-static not installed?)')
}

let cachedFfmpeg: string | null = null
let cachedFfprobe: string | null = null

export function ffmpegPath(): string {
  if (cachedFfmpeg == null) cachedFfmpeg = resolveFfmpegPath()
  return cachedFfmpeg
}

export function ffprobePath(): string {
  if (cachedFfprobe == null) cachedFfprobe = resolveFfprobePath()
  return cachedFfprobe
}
