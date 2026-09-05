/**
 * Note generation core (2026-09-04): one shared entry used by BOTH the
 * pipeline's summarizing stage and the notes:regenerate IPC channel, so a
 * note refresh never re-downloads the lesson (transcripts/keyframes are
 * reused straight from the library database).
 */
import { readFileSync } from 'fs'
import type { Db } from '../db/open'
import { resolveLibraryPath } from '../library/paths'
import { parseNote, type Note } from './schema'
import { evidenceHitRate, dropUnknownEvidence } from '../../shared/notes/evidence'
import type { ChatPart, OpenAiCompatibleClient } from '../providers/openai-client'

/** Max images embedded in the multimodal summarize call (token guard, U4). */
export const MAX_SUMMARIZE_IMAGES = 20

/** One candidate visual: platform PPT page or keyframe. */
export interface SummarizeImage {
  /** Machine-resolvable evidence id: `ppt:<page>` or `kf:<keyframe id>`. */
  ref: string
  path: string
  /** Seconds from lesson start (keyframes only). */
  at: number | null
}

const SYSTEM_PROMPT =
  '你是课程笔记生成器。只输出一个 JSON 对象，不要多余文字。JSON 结构：{overview, knowledgeTree:{title,children:[{title,children}]},timeline:[{at,title,detail,refs:[{at,text}],evidence:[{kind,ref}]}],concepts:[{term,definition,refs}],formulasAndSteps:[{kind,content,explanation,refs}],methodology,examCues:[],questionsAndGaps:[],quiz:[{question,answer,source,term}],transcriptRefs:[{at,text}],evidence:[{kind,ref}]}。要求：1) 所有 at 字段必须是距课时开始的整数秒（例如 750，不要 mm:ss、不要文字）。2) evidence 的 ref 必须原样选用用户消息里给出的「证据ID」（形如 ppt:0 或 kf:xxx），禁止编造其他文字引用；kind 只能是 ppt 或 keyframe；timeline 每条尽量搭配与其画面内容对应的关键帧证据。3) overview 与 methodology 的值用 Markdown 组织：先一句总起，再用 ## 小节标题与 - 列表分层（overview 建议「本讲主线」「前置知识」等小节；methodology 建议「解题思路」「通用套路」「易错点」等小节），不要输出代码围栏。4) formula/code/operation 只用于 formulasAndSteps。5) quiz 是自测题数组（5-8 题）：每题 question 是提问、answer 是完整答案；source 只能是 concept 或 examCue——锚定本讲某个概念时 source=concept 且必须带 term（原样使用该概念的 term 字段），锚定某个考点时 source=examCue（可省 term）；题目必须能在本讲内容中找到答案，禁止超纲凑数；quiz 放在 JSON 末位，先保证其他字段质量。'

/** Load the images + transcript text that feed a summarize call. */
export function loadSummarizeInputs(db: Db, lessonId: string, libraryRoot: string): { transcriptText: string; images: SummarizeImage[] } | { error: string } {
  const transcriptRow = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(lessonId) as
    | { segments_json: string }
    | undefined
  if (transcriptRow == null) return { error: '转写结果缺失，请先运行完整任务生成转写' }

  const keyframeRows = db
    .prepare('SELECT id, file_path, timestamp_seconds FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds')
    .all(lessonId) as Array<{ id: string; file_path: string; timestamp_seconds: number }>
  const pptRows = db
    .prepare('SELECT page_index, file_path FROM ppt_pages WHERE lesson_id = ? ORDER BY page_index')
    .all(lessonId) as Array<{ page_index: number; file_path: string }>
  // PPT pages first, then keyframes; cap the total to protect tokens (U4).
  const images: SummarizeImage[] = [
    ...pptRows.map((p) => ({ ref: `ppt:${p.page_index}`, path: resolveLibraryPath(libraryRoot, p.file_path), at: null })),
    ...keyframeRows.map((k) => ({ ref: `kf:${k.id}`, path: resolveLibraryPath(libraryRoot, k.file_path), at: Math.round(k.timestamp_seconds) }))
  ].slice(0, MAX_SUMMARIZE_IMAGES)

  let transcriptText = ''
  try {
    transcriptText = (JSON.parse(transcriptRow.segments_json) as Array<{ text: string }>)
      .map((s) => s.text)
      .join('\n')
  } catch {
    return { error: '转写数据损坏，请重跑任务' }
  }
  return { transcriptText, images }
}

/** Post-image instruction: refs must quote the captioned evidence ids verbatim. */
function evidenceInstruction(total: number): string {
  return (
    `\n以上是课件/关键帧图片（共 ${total} 张）。每张图片前的「证据ID」是它唯一的合法引用标识：` +
    'timeline 与顶层 evidence 里的 ref 必须原样选用这些证据ID，禁止编造其他文字引用。' +
    '请为 timeline 条目搭配与其画面内容对应的关键帧证据。'
  )
}

/** Caption before each image so the model can cite the exact evidence id. */
function imageCaption(image: SummarizeImage, position: number, total: number): string {
  const kind = image.ref.startsWith('ppt:') ? 'PPT 课件页' : '课堂关键帧'
  const time = image.at == null ? '' : ` | 时间：${image.at}秒`
  return `[图片 ${position}/${total}] 类型：${kind} | 证据ID：${image.ref}${time}`
}

/** User message content: transcript text + captioned embedded images (U4 + 对齐修复 2026-09-04). */
export function buildUserParts(transcriptText: string, images: SummarizeImage[]): ChatPart[] {
  const parts: ChatPart[] = [{ type: 'text', text: `转写内容：\n${transcriptText}` }]
  const total = images.length
  images.forEach((image, index) => {
    try {
      const base64 = readFileSync(image.path).toString('base64')
      parts.push({ type: 'text', text: imageCaption(image, index + 1, total) })
      parts.push({ type: 'image_url', imageUrl: `data:image/jpeg;base64,${base64}` })
    } catch {
      // A missing image file must not fail the whole summarize stage.
    }
  })
  if (total > 0) parts.push({ type: 'text', text: evidenceInstruction(total) })
  return parts
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

/** Call the multimodal client (with text-only fallback) and parse the note JSON. */
export async function generateNote(
  client: OpenAiCompatibleClient,
  model: string,
  transcriptText: string,
  images: SummarizeImage[],
  signal?: AbortSignal
): Promise<Note> {
  const system = { role: 'system', content: SYSTEM_PROMPT } as const
  let answer: string
  try {
    answer = await client.chatJson(
      [
        system,
        { role: 'user', content: buildUserParts(transcriptText, images) }
      ],
      model,
      undefined,
      signal
    )
  } catch (err) {
    // Provider rejects image input → fall back to a text-only prompt (U4).
    const kind = (err as { kind?: string }).kind
    if (kind !== 'unsupported_visual') throw err
    answer = await client.chatJson(
      [
        system,
        { role: 'user', content: buildUserParts(transcriptText, []) }
      ],
      model,
      undefined,
      signal
    )
  }
  try {
    return parseNote(answer)
  } catch {
    return parseNote(stripFences(answer))
  }
}

/** Insert the note as a new version row; returns the version number. */
export function saveNoteVersion(db: Db, lessonId: string, note: Note, model: string): number {
  const versionRow = db.prepare('SELECT MAX(version) AS v FROM notes WHERE lesson_id = ?').get(lessonId) as { v: number | null }
  const version = (versionRow.v ?? 0) + 1
  db.prepare('INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    `${lessonId}-v${version}`,
    lessonId,
    version,
    JSON.stringify(note),
    'openai-compatible',
    model,
    new Date().toISOString()
  )
  return version
}

/** Full regenerate flow for one lesson: inputs → client call → versioned insert. */
export async function summarizeLesson(
  db: Db,
  client: OpenAiCompatibleClient,
  lessonId: string,
  libraryRoot: string,
  signal?: AbortSignal
): Promise<{ version: number; images: number; hitRate: { hits: number; total: number }; droppedRefs: number } | { error: string }> {
  const binding = db.prepare("SELECT model FROM capability_bindings WHERE capability = 'multimodal'").get() as
    | { model: string }
    | undefined
  if (binding == null) return { error: '未绑定多模态模型，请在设置中配置' }
  const inputs = loadSummarizeInputs(db, lessonId, libraryRoot)
  if ('error' in inputs) return { error: inputs.error }
  try {
    const generated = await generateNote(client, binding.model, inputs.transcriptText, inputs.images, signal)
    // F2 (review): only refs the model actually saw may persist.
    const validRefs = new Set(inputs.images.map((image) => image.ref))
    const { note, dropped } = dropUnknownEvidence(generated, validRefs)
    const version = saveNoteVersion(db, lessonId, note, binding.model)
    // Citation quality signal (roadmap 1.3): refs are judged against the
    // images actually sent — the model never saw attachments beyond the cap.
    const hitRate = evidenceHitRate(note, inputs.images)
    return { version, images: inputs.images.length, hitRate, droppedRefs: dropped }
  } catch (err) {
    return { error: `笔记生成失败: ${(err as Error).message}` }
  }
}
