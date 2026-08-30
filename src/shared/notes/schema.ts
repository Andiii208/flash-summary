/**
 * Structured note schema (spec §5). One JSON powers all four reading views:
 * detailed notes, standard summary, key points, methodology analysis.
 * The model does not generate four independent summaries.
 */
import { z } from 'zod'

export const TranscriptRefSchema = z.object({
  /** Seconds from lesson start. */
  at: z.number().nonnegative(),
  /** Quoted snippet from the transcript. */
  text: z.string()
})

export const EvidenceRefSchema = z.object({
  kind: z.enum(['ppt', 'keyframe']),
  /** ppt page index or keyframe id. */
  ref: z.string()
})

export const TimelineEntrySchema = z.object({
  at: z.number().nonnegative(),
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

/** Parse+validate a stored note JSON; throws with a readable message. */
export function parseNote(json: string): Note {
  const parsed = NoteSchema.safeParse(JSON.parse(json))
  if (!parsed.success) {
    throw new Error(`note JSON failed validation: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
  }
  return parsed.data
}
