/**
 * Locates ffmpeg/ffprobe binaries.
 *
 * MVP decision (recorded in PROGRESS.md): bundle via ffmpeg-static /
 * ffprobe-static npm packages. Binaries live in node_modules in dev and are
 * packaged with the app in Phase 7 (electron-builder extraResources), so no
 * system-wide ffmpeg installation is required.
 */
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Resolve a bundled binary: in dev it lives in node_modules; when packaged
 * (electron-builder extraResources) it sits under <resources>/ffmpeg/.
 */
function packagedBinary(name: string): string | null {
  try {
    // process.resourcesPath exists only inside a packaged Electron app.
    const resourcesDir = (process as unknown as { resourcesPath?: string }).resourcesPath
    if (resourcesDir == null) return null
    const candidate = join(resourcesDir, 'ffmpeg', `${name}.exe`)
    return existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
}

function resolveFfmpegPath(): string {
  const packaged = packagedBinary('ffmpeg')
  if (packaged != null) return packaged
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegStatic = require('ffmpeg-static') as string | null
  if (typeof ffmpegStatic === 'string' && ffmpegStatic !== '' && existsSync(ffmpegStatic)) return ffmpegStatic
  throw new Error('ffmpeg binary not found (ffmpeg-static not installed?)')
}

function resolveFfprobePath(): string {
  const packaged = packagedBinary('ffprobe')
  if (packaged != null) return packaged
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
