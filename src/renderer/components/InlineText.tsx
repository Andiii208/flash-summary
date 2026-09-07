/**
 * 批4 (plan 2026-09-07 v07): inline markdown for single-line note fields.
 *
 * The system prompt only asked overview/methodology to be markdown, but the
 * model freely emits bold markers and backtick-code in definitions,
 * explanations, exam cues and quiz text — printed (and displayed) as literal
 * asterisks. This runs the shared parseInline token parser and renders via
 * MdLite's Inline.
 */
import type { JSX } from 'preact'
import { parseInline } from '../../shared/notes/md-lite'
import { Inline } from './MdLite'

export function InlineText({ text }: { text: string }): JSX.Element {
  return <Inline spans={parseInline(text)} />
}
