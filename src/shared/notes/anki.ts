/**
 * Anki TSV deck generation (roadmap 2.2, 2026-09-04; D2: TSV/CSV, no .apkg).
 * Anki's native text import: one card per line, fields separated by tabs.
 * Two decks come out of one note — concept cards (term → definition) and
 * quiz cards (question → answer) — each row carries the lesson title as its
 * source column so cards stay traceable after import.
 *
 * Field sanitation: tabs/newlines inside a field would split or wrap rows on
 * every Anki version, so they collapse to spaces (plain-text import keeps
 * everything version-compatible — no #html headers). Cells starting with
 * =/+/-/@ get a leading apostrophe so Anki/Excel treat them as text, not
 * formulas (批2 audit 2026-09-19).
 */
import type { Note } from './schema'

export interface AnkiDeck {
  /** File stem suffix, e.g. `Anki-概念卡`. */
  name: string
  /** TSV lines (no trailing newline). */
  rows: string[]
}

/** Collapse row-breaking characters inside one TSV field. */
function sanitizeField(text: string): string {
  const collapsed = text.replace(/[\t\r\n]+/g, ' ').trim()
  // 批2 (audit 2026-09-19): 公式注入中和——Anki/Excel 会把 = + - @ 开头的
  // 单元格当公式执行（CSV 注入），前置单引号后按纯文本导入。
  return /^[=+\-@]/.test(collapsed) ? `'${collapsed}` : collapsed
}

/**
 * 批2 (plan 2026-09-17, D7=A): 概念卡背面带上具体例子——例子是记忆钩子，
 * 而卡面只有一句定义时最容易变成「认得但想不起来」。没有 example 就照旧只给定义。
 */
function conceptBack(concept: Note['concepts'][number]): string {
  const example = concept.example != null ? concept.example.trim() : ''
  return example === '' ? concept.definition : `${concept.definition}\n例：${example}`
}

function conceptRows(note: Note, lessonTitle: string): string[] {
  return note.concepts.map((c) => [sanitizeField(c.term), sanitizeField(conceptBack(c)), sanitizeField(lessonTitle)].join('\t'))
}

function quizRows(note: Note, lessonTitle: string): string[] {
  return note.quiz.map((q) => [sanitizeField(q.question), sanitizeField(q.answer), sanitizeField(lessonTitle)].join('\t'))
}

/**
 * Both decks for a note; decks without data are omitted entirely (D2: 无数
 * 据的堆跳过 — an empty .txt would import as a confusing empty deck).
 */
export function ankiDecks(note: Note, lessonTitle: string): AnkiDeck[] {
  const decks: AnkiDeck[] = []
  const concepts = conceptRows(note, lessonTitle)
  if (concepts.length > 0) decks.push({ name: 'Anki-概念卡', rows: concepts })
  const quiz = quizRows(note, lessonTitle)
  if (quiz.length > 0) decks.push({ name: 'Anki-自测题', rows: quiz })
  return decks
}

/** Full file content for one deck (LF newlines; Anki accepts both). */
export function deckToTsv(deck: AnkiDeck): string {
  return `${deck.rows.join('\n')}\n`
}
