/**
 * Anki TSV deck generation (roadmap 2.2, 2026-09-04; D2: TSV/CSV, no .apkg).
 * Anki's native text import: one card per line, fields separated by tabs.
 * Two decks come out of one note — concept cards (term → definition) and
 * quiz cards (question → answer) — each row carries the lesson title as its
 * source column so cards stay traceable after import.
 *
 * Field sanitation: tabs/newlines inside a field would split or wrap rows on
 * every Anki version, so they collapse to spaces (plain-text import keeps
 * everything version-compatible — no #html headers).
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
  return text.replace(/[\t\r\n]+/g, ' ').trim()
}

function conceptRows(note: Note, lessonTitle: string): string[] {
  return note.concepts.map((c) => [sanitizeField(c.term), sanitizeField(c.definition), sanitizeField(lessonTitle)].join('\t'))
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
