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
import { cleanSegments, formatTimedTranscript } from '../../shared/notes/transcript-clean'
import type { CleanSegment } from '../../shared/notes/transcript-clean'
import { verifyNoteRefs, transcriptRefHitRate } from '../../shared/notes/ref-verify'
import type { RefVerifyStats } from '../../shared/notes/ref-verify'
import { fuseVisualEvidence } from '../../shared/notes/visual-fusion'
import { buildVisualCandidates } from './visual-hash'
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
  /**
   * 批1b: 该时间是从关键帧匹配**推断**出来的（PPT 页本身没有时间戳），
   * 不是实测值。caption 会写成「约 N 秒」，避免把推断当实测。
   */
  atInferred?: boolean
}

/** 形状规约（2026-09-04 起 8 条：JSON 结构/格式/锚定）——质量批1 未改动。 */
const NOTE_SHAPE_PROMPT =
  '你是课程笔记生成器。只输出一个 JSON 对象，不要多余文字。JSON 结构：{overview, knowledgeTree:{title,children:[{title,children}]},timeline:[{at,title,detail,refs:[{at,text}],evidence:[{kind,ref}]}],concepts:[{term,definition,example,refs}],formulasAndSteps:[{kind,content,explanation,refs}],methodology,examCues:[],questionsAndGaps:[],quiz:[{question,answer,source,term}],transcriptRefs:[{at,text}],evidence:[{kind,ref}]}。要求：1) 所有 at 字段必须是距课时开始的整数秒（例如 750，不要 mm:ss、不要文字）。2) evidence 的 ref 必须原样选用用户消息里给出的「证据ID」（形如 ppt:0 或 kf:xxx），禁止编造其他文字引用；kind 只能是 ppt 或 keyframe；timeline 每条尽量搭配与其画面内容对应的关键帧证据。3) overview 与 methodology 的值用 Markdown 组织：先一句总起，再用 ## 小节标题与 - 列表分层（overview 建议「本讲主线」「前置知识」等小节；methodology 建议「解题思路」「通用套路」「易错点」等小节），不要输出代码围栏。4) 除 overview 与 methodology 外的所有字段（detail、definition、content、explanation、examCues、questionsAndGaps、question、answer、节点 title 等）一律输出纯文本：禁止 **加粗**、*斜体*、# 标题、- 列表符号等一切 Markdown 标记，有序步骤直接写「1. 2. 3.」编号加句号。5) formula/code/operation 只用于 formulasAndSteps。6) quiz 是自测题数组（5-8 题）：每题 question 是提问、answer 是完整答案；source 只能是 concept 或 examCue——锚定本讲某个概念时 source=concept 且必须带 term（原样使用该概念的 term 字段），锚定某个考点时 source=examCue（可省 term）；题目必须能在本讲内容中找到答案，禁止超纲凑数；quiz 放在 JSON 末位，先保证其他字段质量。7) knowledgeTree 是思维导图数据：根节点 title 是本讲课时主题；第一层 3-6 个主分支，对应本讲的主要板块；整体 3-4 层，细节放叶子层；节点 title 用名词短语（概念或主题名），不超过 20 字；必须覆盖全讲所有主要板块，不得遗漏；每个节点可带 terms 数组，原样引用本讲 concepts 里出现的 term（禁止编造 concepts 中不存在的词），标出该节点分支涉及的概念。8) conceptLinks 是概念关联数组（最多 5 条，没有强关联就输出空数组）：每条 {from,to,label}，from 和 to 必须原样取自本讲 concepts 的 term 或 knowledgeTree 的节点标题，禁止编造。'

/**
 * 内容质量规约（批1, plan 2026-09-08 note-quality-overhaul）：形状之外规定
 * 「好笔记」的内容下限。真实库探针实证（2026-09-08）：旧 prompt 只管形状，
 * SEU 课概念定义均 35-45 字、考点全空、8 条 evidence ref 全为非法散文。
 * 硬性字数下限只放在「素材就在转写里」的字段（概念/时间线——写长是把素材
 * 写全而非编造）；考点/缺口「没有就是没有」，宁空勿编。
 */
export const NOTE_QUALITY_PROMPT =
  '9) 内容质量规约（与上述形状规则同等约束力）：' +
  '9.1 概念 definition 每条不少于 60 字，必须覆盖「是什么」以及「为什么重要/用在哪/与什么区分」中的至少两项；禁止循环定义（用 term 自身或仅换个说法解释自己）。' +
  '9.2 timeline 的 detail 禁止复读 title，必须写出本段转写中的具体数字、参数、演示结果或结论，每条不少于 60 字；refs 的 text 是转写原文的忠实摘引，可去除口语语气词，但不得改变数字、结论与因果。' +
  '9.3 overview 不少于 150 字，按第 3 条的 ## 小节组织，写成合上时间线也能独立读懂的完整叙述。' +
  '9.4 examCues 每条具体到「考什么、怎么答」（如「手推 xx 的推导过程，注意 yy 成立条件」），禁止「要掌握 xx」「重点复习 xx」式空话；本讲确实没有考试相关信息时允许空数组，禁止为凑数编造。' +
  '9.5 questionsAndGaps 只写讲者在转写中真实留下的悬念、作业要求、含糊带过或「以后再讲」的内容，没有就输出空数组，禁止编造思考题。' +
  '9.6 术语纠错：转写由语音识别产生，含同音错词（如「月华数据集」应为「鸢尾花数据集」、「三网库」应为 scikit-learn）；所有字段必须使用结合关键帧画面与上下文判断出的正确写法，错词不得出现在笔记任何字段中。' +
  '9.7 evidence 的 ref 是机器标识，不是对画面的描述：只能原样复制用户消息「证据ID」清单里的标识串（形如 ppt:12 或 kf:k7）。' +
  '正确示例：{"at":750,"title":"超参数调整演示","detail":"模型宽度从 32 改为 64 后测试集精度由 0.97 回落至 0.87，容量过大导致过拟合。","refs":[{"at":745,"text":"模型宽度从32改为64，看下有什么效果"}],"evidence":[{"kind":"keyframe","ref":"kf:k7"}]}。' +
  '反例（等于没引用，会被直接丢弃）："ref":"超参数调整演示幻灯片"——描述性文字不是证据 ID。' +
  '时间线条目的 refs 时间应落在该条目 at 的同一段讲解内，不得使用无关位置的时间。' +
  '若「证据ID」清单里只有 kf: 开头的关键帧而没有 ppt: 课件页，禁止输出任何 ppt: 引用。' +
  '9.8 conceptLinks 的 label 必须是关系词（前提、对比、易混、推广、步骤、因果、包含），禁止「参数、提升、方法」类名词填充。' +
  '9.9 concepts 的 example 字段是本讲出现的**具体**例子或应用场景：必须写出转写里的真实数字、参数、数据或操作（如「把学习率从 0.1 调到 1.0 后损失直接发散」），禁止「例如在实际应用中」「比如在某些场景下」这类空话；讲者在本讲没有给出例子时**省略该字段**，禁止为了凑字段而编造。' +
  '9.10 example 只用本讲内容，不得引用讲者没提过的外部案例或教材章节。'

/** 完整 system prompt = 形状规约 + 内容质量规约。 */
export const SYSTEM_PROMPT = NOTE_SHAPE_PROMPT + NOTE_QUALITY_PROMPT

/** Load the images + transcript text that feed a summarize call. */
export interface SummarizeInputs {
  /** Timed transcript: `[mm:ss] 文本` lines (batch 1). */
  transcriptText: string
  /** Cleaned segments — the same material, structured, for ref verification. */
  segments: CleanSegment[]
  images: SummarizeImage[]
  /** Every real evidence ref of this lesson — the validity set (batch 1). */
  allRefs: Set<string>
}

export function loadSummarizeInputs(db: Db, lessonId: string, libraryRoot: string): SummarizeInputs | { error: string } {
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
  // Batch 1: validity is judged against every real attachment, not just the
  // ones that fit the token cap — a real ref the model could not have seen
  // must not be deleted as fabricated.
  const allRefs = new Set<string>([
    ...pptRows.map((p) => `ppt:${p.page_index}`),
    ...keyframeRows.map((k) => `kf:${k.id}`)
  ])

  let segments: CleanSegment[]
  try {
    segments = cleanSegments(JSON.parse(transcriptRow.segments_json) as Array<{ at?: number; text?: string }>)
  } catch {
    return { error: '转写数据损坏，请重跑任务' }
  }

  // 批1b: PPT × 关键帧融合。两条通道拍同一块屏幕——PPT 清晰但无时间，关键帧有
  // 时间但模糊。融合后：关键帧与 PPT 页撞图的留 PPT（更清晰），不撞的全留（板书/
  // 演示/软件操作是 PPT 里没有的信息），并用撞上的关键帧给 PPT 页反推时间。
  const fused = fuseVisualEvidence(buildVisualCandidates(pptRows, keyframeRows, libraryRoot), {
    maxImages: MAX_SUMMARIZE_IMAGES
  })
  const byRef = new Map<string, SummarizeImage>([
    ...pptRows.map((p) => [
      `ppt:${p.page_index}`,
      { ref: `ppt:${p.page_index}`, path: resolveLibraryPath(libraryRoot, p.file_path), at: null }
    ] as const),
    ...keyframeRows.map((k) => [
      `kf:${k.id}`,
      { ref: `kf:${k.id}`, path: resolveLibraryPath(libraryRoot, k.file_path), at: Math.round(k.timestamp_seconds) }
    ] as const)
  ])
  const images = fused.selected
    .map((ref) => {
      const image = byRef.get(ref)
      if (image == null) return null
      // 反推出来的时间必须与实测时间在数据上可区分：PPT 页的 at 来自关键帧推断，
      // 显式标记，避免渲染层把它当实测时间展示。
      const inferred = fused.inferredTimes.get(ref)
      return inferred == null ? image : { ...image, at: inferred, atInferred: true }
    })
    .filter((image): image is SummarizeImage => image != null)

  return { transcriptText: formatTimedTranscript(segments), segments, images, allRefs }
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
  // 批1b: PPT 页的时间是推断值（由撞图的关键帧反推），标「约」以免被当成实测。
  const time = image.at == null ? '' : ` | 时间：${image.atInferred === true ? '约 ' : ''}${image.at}秒`
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

/** Strip a leading ```json fence (parse fallback; shared with the polish path). */
export function stripFences(text: string): string {
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

/** Versions kept per lesson — F6 promised a cap of 10, polish makes it matter. */
const KEEP_VERSIONS = 10

/**
 * 读时清洗某课时的转写分片（批1）。summarize / polish / 体检三处共用，
 * 保证核验用的分片与喂给模型的是**同一份**素材。
 */
export function loadCleanSegments(db: Db, lessonId: string): CleanSegment[] | null {
  const row = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(lessonId) as
    | { segments_json: string }
    | undefined
  if (row == null) return null
  try {
    return cleanSegments(JSON.parse(row.segments_json) as Array<{ at?: number; text?: string }>)
  } catch {
    return null
  }
}

/**
 * 读时重算某课时的转写锚命中率（批1）。渲染层没有转写，所以这条指标只能在
 * main 侧算——体检与课程升级对话框共用此入口。只读，不改任何数据。
 */
export function transcriptHitRateFor(db: Db, lessonId: string, note: Note): { hits: number; total: number } | null {
  const segments = loadCleanSegments(db, lessonId)
  if (segments == null) return null
  return transcriptRefHitRate(verifyNoteRefs(note, segments).stats)
}


/** Insert the note as a new version row (pruning beyond KEEP_VERSIONS); returns the version number. */
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
  // F6 (design-review): keep only the newest KEEP_VERSIONS rows — regeneration
  // and polish append versions, and the table grew without bound before this.
  db.prepare('DELETE FROM notes WHERE lesson_id = ? AND version <= ?').run(lessonId, version - KEEP_VERSIONS)
  return version
}

/**
 * Bilibili source context (plan 2026-09-06 M5): the transcript of a B站
 * video gets a one-line provenance header so the note speaks of
 * «视频/讲者» instead of «课堂/老师». SEU rows get no header at all —
 * byte-identical prompts.
 */
function sourceHeader(db: Db, lessonId: string): string {
  const row = db
    .prepare('SELECT l.title AS lesson_title, c.name AS course_name, c.source AS source FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?')
    .get(lessonId) as { lesson_title: string | null; course_name: string | null; source: string | null } | undefined
  if (row?.source !== 'bilibili') return ''
  const course = row.course_name ?? 'B站视频'
  const lesson = row.lesson_title ?? ''
  return `【内容来源：B站视频《${course}》${lesson !== '' ? `之「${lesson}」` : ''}】措辞请用「视频」「讲者」，不要用「课堂」「老师」。\n\n`
}

/** Full regenerate flow for one lesson: inputs → client call → versioned insert. */
export async function summarizeLesson(
  db: Db,
  client: OpenAiCompatibleClient,
  lessonId: string,
  libraryRoot: string,
  signal?: AbortSignal
): Promise<
  | {
      version: number
      images: number
      hitRate: { hits: number; total: number }
      /** Transcript-anchor hit rate (null when there was nothing to judge). */
      transcriptHitRate: { hits: number; total: number } | null
      refStats: RefVerifyStats
      droppedRefs: number
    }
  | { error: string }
> {
  const binding = db.prepare("SELECT model FROM capability_bindings WHERE capability = 'multimodal'").get() as
    | { model: string }
    | undefined
  if (binding == null) return { error: '未绑定多模态模型，请在设置中配置' }
  const inputs = loadSummarizeInputs(db, lessonId, libraryRoot)
  if ('error' in inputs) return { error: inputs.error }
  try {
    const generated = await generateNote(client, binding.model, sourceHeader(db, lessonId) + inputs.transcriptText, inputs.images, signal)
    // F2 (review) + batch 1: refs are validated against EVERY real attachment,
    // not just the ones that fit the token cap — the cap only limits what the
    // model sees, it must not turn a real citation into a "fabrication".
    const { note: evidenceChecked, dropped } = dropUnknownEvidence(generated, inputs.allRefs)
    // Batch 1: the transcript anchors are now verifiable — quotes that cannot
    // be found in the transcript are cleared, out-of-range times dropped.
    const { note, stats } = verifyNoteRefs(evidenceChecked, inputs.segments)
    const version = saveNoteVersion(db, lessonId, note, binding.model)
    // Citation quality signals (roadmap 1.3 + batch 1): the compliance reading
    // deliberately uses the images actually sent — the model never saw the rest.
    const hitRate = evidenceHitRate(note, inputs.images)
    return { version, images: inputs.images.length, hitRate, transcriptHitRate: transcriptRefHitRate(stats), refStats: stats, droppedRefs: dropped }
  } catch (err) {
    return { error: `笔记生成失败: ${(err as Error).message}` }
  }
}
