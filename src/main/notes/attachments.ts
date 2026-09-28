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

/** PNG 文件头（8 字节签名）。 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * H27 (audit 2026-09-28): data URL 的 MIME 按文件头魔数推断。
 *
 * 旧代码一律标 `image/jpeg`，浏览器靠 sniff 才显示得出来——但 PPT 页本来就是
 * PNG（orchestrator 落盘的 `page-%03d.png`），任何认 MIME 的下游（导出的
 * HTML、将来的预览服务）都会错标。魔数对不上时回退 image/jpeg（保持现状：
 * 老库里的 JPEG 关键帧与历史数据不受影响，无法识别也不改标）。
 */
function imageMimeOf(buffer: Buffer): 'image/png' | 'image/jpeg' {
  if (buffer.subarray(0, PNG_MAGIC.length).compare(PNG_MAGIC) === 0) return 'image/png'
  return 'image/jpeg'
}

/** Every stored attachment identity for the lesson — no bytes, tiny IPC. */
export function listAttachmentManifest(db: Db, lessonId: string): AttachmentManifestInfo[] {
  const keyframes = db
    .prepare('SELECT id, timestamp_seconds, hash FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds')
    .all(lessonId) as Array<{ id: string; timestamp_seconds: number; hash: string | null }>
  const pptPages = db
    .prepare('SELECT page_index FROM ppt_pages WHERE lesson_id = ? ORDER BY page_index')
    .all(lessonId) as Array<{ page_index: number }>
  return [
    ...pptPages.map((p) => ({ ref: `ppt:${p.page_index}`, kind: 'ppt' as const, at: null })),
    ...keyframes.map((k) => ({ ref: `kf:${k.id}`, kind: 'keyframe' as const, at: Math.round(k.timestamp_seconds), hash: k.hash ?? undefined }))
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
    return { ref, kind, at, dataUrl: `data:${imageMimeOf(buffer)};base64,${buffer.toString('base64')}` }
  } catch {
    // A missing or unreadable file must not break the whole list.
    return null
  }
}

/**
 * 批 A2: 课时封面（B 站导入时落盘的 cover.jpg）。返回 data URL；没有封面/
 * 文件丢失/超限都返回 null——渲染端用第一张关键帧兜底，SEU 源本来无封面。
 */
export function readLessonCover(db: Db, lessonId: string, libraryRoot: string): string | null {
  const row = db.prepare('SELECT cover_path FROM lessons WHERE id = ?').get(lessonId) as
    | { cover_path: string | null }
    | undefined
  if (row?.cover_path == null || row.cover_path === '') return null
  try {
    const buffer = readFileSync(resolveLibraryPath(libraryRoot, row.cover_path))
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_ATTACHMENT_BYTES) return null
    return `data:image/jpeg;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}
