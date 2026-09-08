/**
 * 批5 (plan 2026-09-07 v07): feedback-driven note polish — a second-pass
 * revise of the latest note (D4 = independent channel, D5 = multimodal
 * binding + truncated transcript). No images are sent: the note JSON plus
 * the transcript give the model everything to act on the feedback.
 *
 * Everything downstream (parseNote → dropUnknownEvidence → saveNoteVersion)
 * is the shared summarize pipeline — the polished note is just version N+1,
 * so all five views/exports render it with zero changes.
 */
import type { Db } from '../db/open'
import { parseNote, type Note } from './schema'
import { dropUnknownEvidence, evidenceHitRate } from '../../shared/notes/evidence'
import type { OpenAiCompatibleClient } from '../providers/openai-client'
import { saveNoteVersion, stripFences } from './summarize'
import { feedbackTagInstructions } from '../../shared/feedback-tags'

/** Same reading-measure cap as qa (24k chars) — polish never needs more. */
const MAX_TRANSCRIPT_CHARS = 24_000
/** Hard cap on the user's free-text feedback (guards the prompt size). */
const MAX_FEEDBACK_TEXT_CHARS = 2_000

export const POLISH_SYSTEM_PROMPT =
  '你是课程笔记润色器。用户会对现有笔记提出反馈（不足之处），你要据此修订笔记。' +
  '只输出一个修订后的完整 JSON 对象，不要多余文字，结构与原笔记完全相同：' +
  '{overview, knowledgeTree:{title,children:[{title,children}]},timeline:[{at,title,detail,refs:[{at,text}],evidence:[{kind,ref}]}],concepts:[{term,definition,refs}],formulasAndSteps:[{kind,content,explanation,refs}],methodology,examCues:[],questionsAndGaps:[],quiz:[{question,answer,source,term}],transcriptRefs:[{at,text}],evidence:[{kind,ref}]}。' +
  '要求：1) 保持原笔记的整体结构与正确内容，只按反馈改进，不要推倒重来；' +
  '2) 所有 at 保持整数秒，evidence/concept refs/timeline refs 原样沿用原笔记中的引用（必要时可从「可用证据ID」列表中补充，禁止编造其他引用）；' +
  '3) 除 overview 与 methodology 用 Markdown 组织外，其余字段一律纯文本，禁止 Markdown 标记；' +
  '4) quiz 若已存在则按改进后的内容同步修订，source/term 锚定规则不变；' +
  '5) 修订幅度与反馈匹配：反馈没提的部分不要乱动；' +
  '6) 质量下限同步（批1 2026-09-08）：修订后的笔记仍须满足生成器的内容质量规约——概念 definition 完整（是什么+为什么/用在哪，禁止循环定义）、timeline detail 含具体数字与结论且禁止复读 title、examCues 具体到「考什么、怎么答」、转写同音错词结合画面纠正为正确术语写法；反馈未提且已达标的部分保持原样。'

/** The latest stored note for a lesson, with its version number. */
function loadLatestNote(db: Db, lessonId: string): { version: number; note: Note } | { error: string } {
  const row = db
    .prepare('SELECT version, note_json FROM notes WHERE lesson_id = ? ORDER BY version DESC LIMIT 1')
    .get(lessonId) as { version: number; note_json: string } | undefined
  if (row == null) return { error: '该课时还没有笔记，请先生成笔记' }
  try {
    return { version: row.version, note: parseNote(row.note_json) }
  } catch {
    return { error: '笔记数据损坏，无法润色' }
  }
}

/** Truncated transcript (qa 同款 24k 上限) — polish may need course content. */
function loadTranscript(db: Db, lessonId: string): string {
  const row = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(lessonId) as
    | { segments_json: string }
    | undefined
  if (row == null) return ''
  try {
    return (JSON.parse(row.segments_json) as Array<{ text?: string }>)
      .map((s) => (typeof s.text === 'string' ? s.text : ''))
      .filter((t) => t !== '')
      .join('\n')
      .slice(0, MAX_TRANSCRIPT_CHARS)
  } catch {
    return ''
  }
}

/** Every evidence id this lesson actually has — polish may only cite these. */
function loadValidRefs(db: Db, lessonId: string): Array<{ ref: string }> {
  const pages = db.prepare('SELECT page_index FROM ppt_pages WHERE lesson_id = ? ORDER BY page_index').all(lessonId) as Array<{ page_index: number }>
  const keyframes = db.prepare('SELECT id FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds').all(lessonId) as Array<{ id: string }>
  return [
    ...pages.map((p) => ({ ref: `ppt:${p.page_index}` })),
    ...keyframes.map((k) => ({ ref: `kf:${k.id}` }))
  ]
}

/** The polish user message: original note + feedback + transcript excerpt. */
export function buildPolishUserParts(originalNote: Note, feedback: { tags: string[]; text: string }, transcriptText: string, validRefs: string[]): string {
  const lines: string[] = ['【原笔记 JSON】', JSON.stringify(originalNote), '']
  const instructions = feedbackTagInstructions(feedback.tags)
  lines.push('【用户反馈】')
  if (instructions.length > 0) lines.push(...instructions.map((s) => `- ${s}`))
  if (feedback.text !== '') lines.push(`补充说明：${feedback.text}`)
  if (instructions.length === 0 && feedback.text === '') lines.push('- （用户未选择具体问题，请对笔记做一次整体的查漏与润饰）')
  lines.push('', '【课程转写摘录】（润色内容必须仍以本讲真实内容为依据，不得超纲编造）', transcriptText === '' ? '（无转写，仅以原笔记为准）' : transcriptText)
  lines.push('', `【可用证据ID】${validRefs.length > 0 ? validRefs.join('、') : '（无）'}`)
  return lines.join('\n')
}

/** Full polish flow for one lesson: latest note + feedback → new version. */
export async function polishNote(
  db: Db,
  client: OpenAiCompatibleClient,
  lessonId: string,
  feedback: { tags: string[]; text: string }
): Promise<{ version: number; hitRate: { hits: number; total: number }; droppedRefs: number } | { error: string }> {
  const binding = db.prepare("SELECT model FROM capability_bindings WHERE capability = 'multimodal'").get() as
    | { model: string }
    | undefined
  if (binding == null) return { error: '未绑定多模态模型，请在设置中配置' }
  const latest = loadLatestNote(db, lessonId)
  if ('error' in latest) return { error: latest.error }
  const validRefs = loadValidRefs(db, lessonId)
  const refsOnly = validRefs.map((r) => r.ref)
  const userText = buildPolishUserParts(latest.note, { tags: feedback.tags, text: feedback.text.slice(0, MAX_FEEDBACK_TEXT_CHARS) }, loadTranscript(db, lessonId), refsOnly)
  try {
    let answer = await client.chatJson(
      [
        { role: 'system', content: POLISH_SYSTEM_PROMPT },
        { role: 'user', content: userText }
      ],
      binding.model
    )
    let polished: Note
    try {
      polished = parseNote(answer)
    } catch {
      answer = stripFences(answer)
      polished = parseNote(answer)
    }
    const { note, dropped } = dropUnknownEvidence(polished, new Set(refsOnly))
    const version = saveNoteVersion(db, lessonId, note, `${binding.model} (润色)`)
    const hitRate = evidenceHitRate(note, validRefs)
    return { version, hitRate, droppedRefs: dropped }
  } catch (err) {
    return { error: `润色失败: ${(err as Error).message}` }
  }
}
