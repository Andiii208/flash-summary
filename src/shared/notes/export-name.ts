/**
 * 批D: canonical export file name — course, teacher and lesson title all in
 * the name so exports from different courses never collide as «第3节课.md».
 * Pure and deterministic; shared by the markdown/Anki/PDF export IPCs.
 */

/** Strip characters that are unsafe in a Windows file name. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'note'
}

export interface ExportNameParts {
  courseName?: string | null
  teacher?: string | null
  /** Platform wording, e.g. «第3节课» — the lesson number lives here. */
  lessonTitle?: string | null
  /** Fallback when nothing else is known (manual-add courses). */
  lessonId?: string | null
}

/** Join the non-empty parts with « - », dropping empty segments entirely. */
export function noteExportBaseName(parts: ExportNameParts): string {
  const segments = [parts.courseName, parts.teacher, parts.lessonTitle]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s !== '')
  const fallback = parts.lessonId?.trim() || ''
  return safeFileName(segments.length > 0 ? segments.join(' - ') : fallback || 'note')
}
