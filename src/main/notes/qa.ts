/**
 * Follow-up Q&A over the current lesson only (spec §6).
 *
 * Context assembly (in order): structured note overview, transcript,
 * PPT/keyframe evidence ids, prior Q&A for THIS lesson. course_id is
 * reserved but course-level questions are out of MVP scope.
 */
import type { Db } from '../db/open'
import type { Note } from './schema'

export interface QaContext {
  lessonId: string
  note: Note | null
  transcriptText: string
  evidenceIds: string[]
  priorQa: Array<{ question: string; answer: string }>
}

const MAX_TRANSCRIPT_CHARS = 24_000
const MAX_PRIOR_QA = 10

/** Assemble the current-lesson context from the library database. */
export function assembleContext(db: Db, lessonId: string, note: Note | null): QaContext {
  const transcriptRow = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(lessonId) as
    | { segments_json: string }
    | undefined
  let transcriptText = ''
  if (transcriptRow != null) {
    try {
      const segments = JSON.parse(transcriptRow.segments_json) as Array<{ at?: number; text?: string }>
      transcriptText = segments
        .map((s) => (typeof s.text === 'string' ? s.text : ''))
        .filter((t) => t !== '')
        .join('\n')
        .slice(0, MAX_TRANSCRIPT_CHARS)
    } catch {
      transcriptText = ''
    }
  }

  const evidenceIds = [
    ...(db.prepare('SELECT page_index FROM ppt_pages WHERE lesson_id = ? ORDER BY page_index').all(lessonId) as Array<{ page_index: number }>).map(
      (r) => `ppt:${r.page_index}`
    ),
    ...(db.prepare('SELECT id FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds').all(lessonId) as Array<{ id: string }>).map(
      (r) => `kf:${r.id}`
    )
  ]

  const priorQa = (
    db.prepare('SELECT question, answer FROM qa WHERE lesson_id = ? ORDER BY created_at DESC LIMIT ?').all(lessonId, MAX_PRIOR_QA) as Array<{
      question: string
      answer: string
    }>
  ).reverse()

  return { lessonId, note, transcriptText, evidenceIds, priorQa }
}

/** Build chat messages for a question, scoped strictly to this lesson. */
export function buildQaMessages(ctx: QaContext, question: string): Array<{ role: 'system' | 'user'; content: string }> {
  const parts: string[] = [
    '你是课程助教，只基于当前课时的材料回答问题。材料之外的内容请明确说明资料中未涵盖。',
    `当前课时 ID：${ctx.lessonId}（仅限本课时，不回答其他课时的问题）。`
  ]
  if (ctx.note != null) {
    parts.push(`笔记概要：${ctx.note.overview}`)
    parts.push(`方法论：${ctx.note.methodology}`)
  }
  if (ctx.transcriptText !== '') parts.push(`转写摘录：\n${ctx.transcriptText}`)
  if (ctx.evidenceIds.length > 0) parts.push(`可用证据：${ctx.evidenceIds.join(', ')}`)
  if (ctx.priorQa.length > 0) {
    parts.push(`本课时此前的问答：\n${ctx.priorQa.map((qa) => `问：${qa.question}\n答：${qa.answer}`).join('\n')}`)
  }
  parts.push(`问题：${question}`)

  return [
    { role: 'system', content: '回答使用简体中文，结构化、引用材料中的时间点或证据。' },
    { role: 'user', content: parts.join('\n\n') }
  ]
}

/** Persist a completed Q&A exchange. */
export function recordQa(db: Db, lessonId: string, question: string, answer: string): string {
  const id = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  db.prepare('INSERT INTO qa (id, lesson_id, course_id, question, answer, created_at) VALUES (?, ?, NULL, ?, ?, ?)').run(
    id,
    lessonId,
    question,
    answer,
    new Date().toISOString()
  )
  return id
}
