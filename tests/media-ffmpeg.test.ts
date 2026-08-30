import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { extractAudio, extractKeyframes, probeMedia, fileSizeOrNull } from '../src/main/media/ffmpeg'
import { ffmpegPath, ffprobePath } from '../src/main/media/binaries'

let dir: string
let screenVideo: string
let teacherVideo: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-media-'))

  // Generate tiny real sample media with the bundled ffmpeg:
  // - screen video: 6s, 64x64, color bars (keyframe source stand-in)
  // - teacher video: 2s tone (audio source stand-in)
  screenVideo = join(dir, 'screen.mp4')
  teacherVideo = join(dir, 'teacher.mp4')
  execFileSync(ffmpegPath(), [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=64x64:rate=2',
    '-pix_fmt', 'yuv420p', screenVideo
  ], { stdio: 'pipe' })
  execFileSync(ffmpegPath(), [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', teacherVideo
  ], { stdio: 'pipe' })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('probeMedia (real ffprobe)', () => {
  it('reads duration and dimensions of the generated screen video', async () => {
    const info = await probeMedia(screenVideo, ffprobePath())
    expect(info.durationSeconds).toBeGreaterThan(5)
    expect(info.durationSeconds).toBeLessThanOrEqual(6.5)
    expect(info.width).toBe(64)
    expect(info.height).toBe(64)
  })
})

describe('extractAudio (real ffmpeg)', () => {
  it('produces a mono 16 kHz wav with the right duration', async () => {
    const out = await extractAudio(teacherVideo, dir, ffmpegPath())
    expect(existsSync(out.audioPath)).toBe(true)
    expect(out.audioPath.endsWith('.wav')).toBe(true)
    expect(out.durationSeconds).toBeGreaterThan(1.5)
    expect(out.durationSeconds).toBeLessThanOrEqual(2.5)

    const info = await probeMedia(out.audioPath, ffprobePath())
    expect(info.width).toBe(0) // audio-only: no video stream
    expect(statSync(out.audioPath).size).toBeGreaterThan(10_000)
  })
})

describe('extractKeyframes (real ffmpeg)', () => {
  it('produces candidate frames at the requested interval', async () => {
    const outDir = join(dir, 'frames')
    const frames = await extractKeyframes(screenVideo, outDir, 2, ffmpegPath())
    // 6s at 1 frame per 2s => 3 frames (0, 2, 4s timestamps)
    expect(frames.length).toBe(3)
    expect(frames[0].timestampSeconds).toBe(0)
    expect(frames[1].timestampSeconds).toBe(2)
    for (const f of frames) {
      expect(existsSync(f.filePath)).toBe(true)
      expect(statSync(f.filePath).size).toBeGreaterThan(500)
    }
  })
})

describe('temporary-file lifecycle helpers', () => {
  it('fileSizeOrNull returns null for missing files (deleted temp artifacts)', () => {
    const missing = join(dir, 'gone.mp4')
    expect(fileSizeOrNull(missing)).toBeNull()
    const present = join(dir, 'here.txt')
    writeFileSync(present, 'x')
    expect(fileSizeOrNull(present)).toBeGreaterThan(0)
  })
})
