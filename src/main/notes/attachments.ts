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

/** Load every stored attachment for the lesson (missing files are skipped). */
export function listAttachments(db: Db, lessonId: string, libraryRoot: string): AttachmentLike[] {
  const keyframes = db
    .prepare('SELECT id, file_path, timestamp_seconds FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds')
    .all(lessonId) as Array<{ id: string; file_path: string; timestamp_seconds: number }>
  const pptPages = db
    .prepare('SELECT page_index, file_path FROM ppt_pages WHERE lesson_id = ? ORDER BY page_index')
    .all(lessonId) as Array<{ page_index: number; file_path: string }>
  return [
    ...pptPages.map((p) => toAttachment(`ppt:${p.page_index}`, 'ppt', null, resolveLibraryPath(libraryRoot, p.file_path))),
    ...keyframes.map((k) => toAttachment(`kf:${k.id}`, 'keyframe', Math.round(k.timestamp_seconds), resolveLibraryPath(libraryRoot, k.file_path)))
  ].filter((a): a is AttachmentLike => a != null)
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
