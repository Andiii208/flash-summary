/**
 * ASR chunking (U4, required): upload caps bound the chunk size. A 45-minute
 * 16kHz mono WAV ≈ 86MB. We cut the audio at fixed boundaries, transcribe
 * each chunk, and stitch the segments back with the chunk offset as the
 * segment start time. Cutting at silence would preserve sentence boundaries
 * better but is more complex; fixed boundaries are the simpler reliable
 * option (PROGRESS note).
 *
 * The default is 120s (field-calibrated 2026-09-02): chat-style ASR
 * platforms carry the audio as a base64 data URL and the gateway resets
 * connections above ~7MB encoded despite the documented 10MB — a 120s
 * 16kHz-mono chunk is ~3.8MB raw / ~5.1MB base64, safely under. This also
 * satisfies the classic 25MB multipart cap.
 */
import { join } from 'path'
import { run } from './ffmpeg'

export interface ChunkSpec {
  index: number
  start: number
  end: number
}

export const DEFAULT_CHUNK_SECONDS = 120

/** Divide a duration into chunk specs (≥1 chunk, last one clamped). */
export function chunkPlan(durationSeconds: number, chunkSeconds = DEFAULT_CHUNK_SECONDS): ChunkSpec[] {
  const total = Math.max(0, durationSeconds)
  const count = Math.max(1, Math.ceil(total / chunkSeconds))
  const specs: ChunkSpec[] = []
  for (let i = 0; i < count; i++) {
    specs.push({ index: i, start: i * chunkSeconds, end: Math.min(total, (i + 1) * chunkSeconds) })
  }
  return specs
}

/** Cut one chunk from the source wav into its own 16k mono wav file. */
export async function cutChunk(
  ffmpeg: string,
  source: string,
  outDir: string,
  spec: ChunkSpec,
  signal?: AbortSignal
): Promise<string> {
  const target = join(outDir, `chunk-${String(spec.index).padStart(3, '0')}.wav`)
  await run(ffmpeg, [
    '-y',
    '-ss', String(spec.start),
    '-t', String(spec.end - spec.start),
    '-i', source,
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    target
  ], { signal })
  return target
}
