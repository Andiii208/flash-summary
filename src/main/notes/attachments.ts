/**
 * Attachment loading for the renderer (2026-09-04): keyframes + PPT pages
 * of one lesson, read from disk as base64 data URLs. CSP allows img-src
 * data:, so the renderer needs no file:// exception.
 */
import { readFileSync } from 'fs'
import type { Db } from '../db/open'
import { resolveLibraryPath } from '../library/paths'
import type { AttachmentLike } from '../../shared/notes/evidence'

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

/** F4 (review): manifest entry — identity WITHOUT the payload. */
export interface AttachmentManifestInfo {
  ref: string
  kind: 'ppt' | 'keyframe'
  at: number | null
}

/** Every stored attachment identity for the lesson — no bytes, tiny IPC. */
export function listAttachmentManifest(db: Db, lessonId: string): AttachmentManifestInfo[] {
  const keyframes = db
    .prepare('SELECT id, timestamp_seconds FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds')
    .all(lessonId) as Array<{ id: string; timestamp_seconds: number }>
  const pptPages = db
    .prepare('SELECT page_index FROM ppt_pages WHERE lesson_id = ? ORDER BY page_index')
    .all(lessonId) as Array<{ page_index: number }>
  return [
    ...pptPages.map((p) => ({ ref: `ppt:${p.page_index}`, kind: 'ppt' as const, at: null })),
    ...keyframes.map((k) => ({ ref: `kf:${k.id}`, kind: 'keyframe' as const, at: Math.round(k.timestamp_seconds) }))
  ]
}

/** Load ONE attachment's bytes for the lesson (missing files resolve null). */
export function readAttachmentData(db: Db, lessonId: string, ref: string, libraryRoot: string): AttachmentLike | null {
  const pptMatch = /^ppt:(\d+)$/.exec(ref)
  const kfMatch = /^kf:([\w.-]+)$/.exec(ref)
  let row: { file_path: string; timestamp_seconds?: number } | undefined
  if (pptMatch != null) {
    row = db.prepare('SELECT file_path FROM ppt_pages WHERE lesson_id = ? AND page_index = ?').get(lessonId, Number(pptMatch[1])) as
      | { file_path: string }
      | undefined
  } else if (kfMatch != null) {
    row = db.prepare('SELECT file_path, timestamp_seconds FROM keyframes WHERE lesson_id = ? AND id = ?').get(lessonId, kfMatch[1]) as
      | { file_path: string; timestamp_seconds: number }
      | undefined
  } else {
    return null
  }
  if (row == null) return null
  const at = row.timestamp_seconds != null ? Math.round(row.timestamp_seconds) : null
  return toAttachment(ref, pptMatch != null ? 'ppt' : 'keyframe', at, resolveLibraryPath(libraryRoot, row.file_path))
}
function toAttachment(
  ref: string,
  kind: 'ppt' | 'keyframe',
  at: number | null,
  filePath: string
): AttachmentLike | null {
  try {
    const buffer = readFileSync(filePath)
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_ATTACHMENT_BYTES) return null
    return { ref, kind, at, dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}` }
  } catch {
    // A missing or unreadable file must not break the whole list.
    return null
  }
}
