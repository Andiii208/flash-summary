/**
 * Structured note schema (spec §5). One JSON powers all four reading views:
 * detailed notes, standard summary, key points, methodology analysis.
 * The model does not generate four independent summaries.
 */
import { z } from 'zod'

export const TranscriptRefSchema = z.object({
  /** Seconds from lesson start (coerced: models emit numeric strings). */
  at: z.coerce.number().nonnegative(),
  /** Quoted snippet from the transcript. */
  text: z.string()
})

export const EvidenceRefSchema = z.object({
  kind: z.enum(['ppt', 'keyframe']),
  /** ppt page index or keyframe id. */
  ref: z.string()
})

export const TimelineEntrySchema = z.object({
  at: z.coerce.number().nonnegative(),
  title: z.string(),
  detail: z.string(),
  refs: z.array(TranscriptRefSchema).default([]),
  evidence: z.array(EvidenceRefSchema).default([])
})

export const ConceptSchema = z.object({
  term: z.string(),
  definition: z.string(),
  refs: z.array(TranscriptRefSchema).default([])
})

export const FormulaOrStepSchema = z.object({
  kind: z.enum(['formula', 'code', 'operation']),
  content: z.string(),
  explanation: z.string().default(''),
  refs: z.array(TranscriptRefSchema).default([])
})

export const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    title: z.string(),
    children: z.array(TreeNodeSchema).default([])
  })
)

export interface TreeNode {
  title: string
  children: TreeNode[]
}

export const NoteSchema = z.object({
  overview: z.string(),
  knowledgeTree: TreeNodeSchema,
  timeline: z.array(TimelineEntrySchema).default([]),
  concepts: z.array(ConceptSchema).default([]),
  formulasAndSteps: z.array(FormulaOrStepSchema).default([]),
  /** 方法论分析 */
  methodology: z.string(),
  /** 考试与作业提示 */
  examCues: z.array(z.string()).default([]),
  /** 疑问与缺口 */
  questionsAndGaps: z.array(z.string()).default([]),
  transcriptRefs: z.array(TranscriptRefSchema).default([]),
  evidence: z.array(EvidenceRefSchema).default([])
})

export type Note = z.infer<typeof NoteSchema>

/**
 * Normalize model-emitted timestamps before validation: the spec wants
 * integer seconds, but models frequently emit "mm:ss" (field case 2026-09-02,
 * mimo-v2.5) or numeric strings. Unknown shapes pass through untouched so
 * zod still reports them.
 */
function coerceAt(value: unknown): unknown {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) return Number(trimmed)
    const parts = trimmed.split(':')
    if (parts.length >= 2 && parts.every((p) => /^\d+$/.test(p))) {
      return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
    }
  }
  return value
}

/**
 * Evidence kind must be ppt|keyframe; models leak the formulaAndSteps kinds
 * (formula/code/operation) into it (field case 2026-09-02). The ref value
 * itself is authoritative: ppt refs are `ppt:<page>`, keyframes `kf:<id>`.
 */
function normalizeEvidence(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.map((entry) => {
    if (entry == null || typeof entry !== 'object') return entry
    const e = entry as Record<string, unknown>
    if (e.kind === 'ppt' || e.kind === 'keyframe') return e
    const ref = typeof e.ref === 'string' ? e.ref : ''
    return { ...e, kind: ref.startsWith('ppt') ? 'ppt' : 'keyframe' }
  })
}

function withNormalizedTimestamps(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object') return raw
  const obj = raw as Record<string, unknown>
  const fixList = (list: unknown): unknown =>
    Array.isArray(list)
      ? list.map((entry) => {
          if (entry == null || typeof entry !== 'object') return entry
          const e = entry as Record<string, unknown>
          return {
            ...e,
            at: coerceAt(e.at),
            ...(Array.isArray(e.refs)
              ? {
                  refs: e.refs.map((r) =>
                    r != null && typeof r === 'object' ? { ...(r as Record<string, unknown>), at: coerceAt((r as Record<string, unknown>).at) } : r
                  )
                }
              : {}),
            ...(e.evidence != null ? { evidence: normalizeEvidence(e.evidence) } : {})
          }
        })
      : list
  return {
    ...obj,
    timeline: fixList(obj.timeline),
    transcriptRefs: fixList(obj.transcriptRefs),
    evidence: normalizeEvidence(obj.evidence)
  }
}

const ValidatedNoteSchema = z.preprocess(withNormalizedTimestamps, NoteSchema)

/**
 * Common LLM JSON slips (field case 2026-09-02): markdown fences, prose
 * around the object, trailing commas. Repair is best-effort — unparsable
 * output still throws so the caller can surface a real error.
 */
function repairJsonCandidate(text: string): string {
  let s = text.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first > 0 || (first !== -1 && last !== -1 && last < s.length - 1)) {
    s = s.slice(first, last + 1)
  }
  return s.replace(/,\s*([}\]])/g, '$1')
}

/** Parse+validate a stored note JSON; throws with a readable message. */
export function parseNote(json: string): Note {
  // Two attempts: verbatim, then the repaired candidate. Both may throw at
  // JSON.parse (syntax) — the first error is preserved for the caller.
  let firstError: Error | null = null
  for (const text of [json, repairJsonCandidate(json)]) {
    let parsed
    try {
      parsed = ValidatedNoteSchema.safeParse(JSON.parse(text))
    } catch (err) {
      firstError = firstError ?? (err as Error)
      continue
    }
    if (parsed.success) return parsed.data
    const issue = parsed.error.issues[0]
    firstError = new Error(`note JSON failed validation: ${issue?.path.join('.')} ${issue?.message}`)
  }
  throw firstError ?? new Error('note JSON failed validation')
}
