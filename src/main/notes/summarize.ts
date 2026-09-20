/**
 * Note generation core (2026-09-04): one shared entry used by BOTH the
 * pipeline's summarizing stage and the notes:regenerate IPC channel, so a
 * note refresh never re-downloads the lesson (transcripts/keyframes are
 * reused straight from the library database).
 */
import { readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { Db } from '../db/open'
import { resolveLibraryPath, attachmentsPath } from '../library/paths'
import {
  parseNote,
  parseNoteWithDiagnostics,
  type Note,
  type NormalizationDropCounts,
  type ParsedNote
} from './schema'
import { evidenceHitRate, dropUnknownEvidence } from '../../shared/notes/evidence'
import { cleanSegments, formatTimedTranscript } from '../../shared/notes/transcript-clean'
import type { CleanSegment } from '../../shared/notes/transcript-clean'
import { verifyNoteRefs, transcriptRefHitRate, clampNoteTimes, verifyTranscriptRefs } from '../../shared/notes/ref-verify'
import { modelHasVision } from '../../shared/model-vision'
import { noteHealth } from '../../shared/notes/health'
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
  '你是课程笔记生成器。只输出一个 JSON 对象，不要多余文字。JSON 结构：{overview, tldr, quotes:[{at,text}],chapters:[{at,title,summary}],knowledgeTree:{title,children:[{title,children}]},timeline:[{at,title,detail,refs:[{at,text}],evidence:[{kind,ref}]}],concepts:[{term,definition,example,refs}],formulasAndSteps:[{kind,content,explanation,refs}],methodology,examCues:[],questionsAndGaps:[],quiz:[{question,answer,source,term}],transcriptRefs:[{at,text}],evidence:[{kind,ref}]}。要求：1) 所有 at 字段必须是距课时开始的整数秒（例如 750，不要 mm:ss、不要文字）。2) evidence 的 ref 必须原样选用用户消息里给出的「证据ID」（形如 ppt:0 或 kf:xxx），禁止编造其他文字引用；kind 只能是 ppt 或 keyframe；timeline 每条都应引用与其画面内容对应的证据（从下方图片的「证据ID」中原样选用）；只有该条内容确实没有对应画面时才留空——**宁可留空也不得编造 ref**。3) overview 与 methodology 的值用 Markdown 组织：先一句总起，再用 ## 小节标题与 - 列表分层（overview 建议「本讲主线」「前置知识」等小节；methodology 建议「解题思路」「通用套路」「易错点」等小节），不要输出代码围栏。4) 除 overview、methodology 与 formula 的 content 外，所有字段（detail、definition、content、explanation、examCues、questionsAndGaps、question、answer、节点 title 等）一律输出纯文本：禁止 **加粗**、*斜体*、# 标题、- 列表符号等一切 Markdown 标记，有序步骤直接写「1. 2. 3.」编号加句号。**例外：kind="formula" 的 content 必须用 LaTeX 书写**（等号、分式、上下标、求和、希腊字母等一律 LaTeX，如「$$L = -\\frac{1}{N}\\sum_{i=1}^{N} y_i \\log p_i$$」；单行短公式用 $...$ 包起来，独立成行的大公式用 $$...$$ 包起来）。渲染器会用 KaTeX 排版，写成「L = -(1/N) Σ y log p」这样的纯文本反而对不齐、看不清。5) formula/code/operation 只用于 formulasAndSteps。6) quiz 是自测题数组（5-8 题）：每题 question 是提问、answer 是完整答案；source 只能是 concept 或 examCue——锚定本讲某个概念时 source=concept 且必须带 term（原样使用该概念的 term 字段），锚定某个考点时 source=examCue（可省 term）；题目必须能在本讲内容中找到答案，禁止超纲凑数；quiz 放在 JSON 末位，先保证其他字段质量。7) knowledgeTree 是思维导图数据：根节点 title 是本讲课时主题；第一层 3-6 个主分支，对应本讲的主要板块；整体 3-4 层，细节放叶子层；节点 title 用名词短语（概念或主题名），不超过 20 字；必须覆盖全讲所有主要板块，不得遗漏；每个节点可带 terms 数组，原样引用本讲 concepts 里出现的 term（禁止编造 concepts 中不存在的词），标出该节点分支涉及的概念。8) conceptLinks 是概念关联数组（最多 5 条，没有强关联就输出空数组）：每条 {from,to,label}，from 和 to 必须原样取自本讲 concepts 的 term 或 knowledgeTree 的节点标题，禁止编造。'

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
  '9.10 example 只用本讲内容，不得引用讲者没提过的外部案例或教材章节。' +
  '9.11 去 AI 味（批6：笔记的 AI 味与文章同源——太均匀、太正确、太完整）：' +
  '① 去路标：禁止「值得注意的是」「综上所述」「本节主要介绍」「首先/其次/最后」这类模型路标——它们在语音转写里根本不存在，出现即模型加的；' +
  '② 具体优先：概念定义与时间线 detail 必须落到本讲的具体数字、参数、演示结果，抽象概括只在给出具体内容之后用一句收束；' +
  '③ 不均匀化：不要求每条概念长度相近、每条时间线含相同要素——讲者讲得多的地方就该写得多，一笔带过的地方就写短，禁止为了整齐而填充。' +
  '9.12 tldr 是一句话总结（不超过 80 字）：这堂课/这支视频讲了什么、最核心的一个结论是什么——让读者在打开时间线之前就判断值不值得读；写具体结论不写路标（同 9.11）；内容太少不足以概括时**省略该字段**，禁止为填字段写废话。' +
  '9.13 chapters 是章节数组（3-8 章，长视频取 6-8）：每章 {at,title,summary}，at 为该章起点的整数秒（时间线条目自然落在章内）；每章是一个主题板块、应覆盖多条时间线条目，不得与时间线条目一一对应；title 用名词短语（不超 12 字），summary 一句话说清这一部分讲了什么；本讲没有清晰的章节结构时输出空数组，禁止为凑整齐。' +
  '9.14 quotes 是金句数组（0-5 条）：讲者的原话逐字摘引（at 为该句开始的秒数）——讲判断做结论、有名的表述才值得摘；**不得改写、不得摘转写里没有的话**；本讲没有值得摘的原话时输出空数组，禁止为填数编造。' +
  '9.15 evidence 引用是「原样复制」而不是描述：用户消息里每张图片都带「证据ID：xxx」，timeline 的 evidence 就写 [{"kind":"keyframe","ref":"xxx"}]——ref 与该标识串逐字节一致（含 kf: 前缀与 Id 部分）。示例：图片标注「[图片 2/18] 类型：课堂关键帧 | 证据ID：kf:bili-BV1tNpbekEht-P1-kf-1 | 时间：990秒」，讲数组引言的时间线条目就应引用它。引用不上的条留空数组；把 ref 写成「数组那一页」「第三张图」这类描述等于编造，会被归一层整条丢弃并计数。'

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
  /** A3: 本课时真实素材数（风控断供/无流时 keyframes=0，用户侧必须看得见）。 */
  visualAssets: { keyframes: number; ppt: number }
}

export function loadSummarizeInputs(db: Db, lessonId: string, libraryRoot: string): SummarizeInputs | { error: string } {
  try {
    return loadSummarizeInputsInner(db, lessonId, libraryRoot)
  } finally {
    // 终审修复波: 缩略图清理移进 finally——转写缺失/损坏的早退路径此前直接
    // return error，上一轮崩到一半留下的 thumb-* 永远不清（≤几 KB/张，但
    // 跨轮残留没有兜底）。
    cleanupThumbnails(libraryRoot, lessonId)
  }
}

function loadSummarizeInputsInner(db: Db, lessonId: string, libraryRoot: string): SummarizeInputs | { error: string } {
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

  // 视觉候选装配完毕（哈希已吃完缩略图）——缩略图的删除在外层
  // loadSummarizeInputs 的 finally 里（早退路径也要清）。

  return {
    transcriptText: formatTimedTranscript(segments),
    segments,
    images,
    allRefs,
    visualAssets: { keyframes: keyframeRows.length, ppt: pptRows.length }
  }
}

/**
 * 批3: 缩略图只服务上面的哈希装配——装完即删该 lesson 两个附件目录的
 * `thumb-*`。best-effort：目录不存在/删不掉都不抛（崩溃残留 ≤几 KB/张，
 * 由附件 GC 批兜底；哈希产物不入库，下次装配时按需再生成）。
 */
function cleanupThumbnails(libraryRoot: string, lessonId: string): void {
  for (const sub of ['ppt', 'keyframes'] as const) {
    const dir = join(attachmentsPath(libraryRoot), lessonId, sub)
    try {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('thumb-')) rmSync(join(dir, name), { force: true })
      }
    } catch {
      // 目录不存在/不可读：没有需要清理的缩略图
    }
  }
}

/** Post-image instruction: refs must quote the captioned evidence ids verbatim. */
function evidenceInstruction(total: number): string {
  return (
    `\n以上是课件/关键帧图片（共 ${total} 张）。每张图片前的「证据ID」是它唯一的合法引用标识：` +
    'timeline 与顶层 evidence 里的 ref 必须原样选用这些证据ID，禁止编造其他文字引用。' +
    '请为每条 timeline 条目搭配与其画面内容对应的证据（原样复制上面的证据ID）；没有对应画面的条留空，不要编造。'
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
): Promise<ParsedNote> {
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
    return parseNoteWithDiagnostics(answer)
  } catch {
    return parseNoteWithDiagnostics(stripFences(answer))
  }
}

/** Versions kept per lesson — F6 promised a cap of 10, polish makes it matter. */
const KEEP_VERSIONS = 10

// 批3: 工艺版本常量的唯一事实源在 shared/notes/schema.ts（渲染层也要读它）；
// 这里 import + 再导出，让 main 侧调用点不必记两个路径。
import { CURRENT_PROMPT_VERSION, CURRENT_SCHEMA_VERSION } from '../../shared/notes/schema'
export { CURRENT_PROMPT_VERSION, CURRENT_SCHEMA_VERSION }

/** 批3: 返修用的 system prompt。 */
export const REPAIR_SYSTEM_PROMPT =
  '你是课程笔记修订器。用户会给你一份已生成的笔记 JSON、以及体检发现的**具体问题清单**。' +
  '你的任务只修这些问题，不要重写、不要新增体检没提到的改动。' +
  '要求：1) 输出完整的修订后 JSON，结构与原笔记完全相同；' +
  '2) 所有 at 保持整数秒，evidence 与 refs 沿用原文，禁止编造新的证据ID或摘引；' +
  '3) 把字数不足的字段写足——依据是转写摘录里的真实内容，不是想象；' +
  '4) 若某个问题在转写里确实找不到依据（例如本讲根本没给例子），**保持原样不要编造**，宁可让这条问题继续存在；' +
  '5) 除 overview 与 methodology 用 Markdown 组织外，其余字段纯文本，禁止 Markdown 标记。'

/** 返修输入：待修笔记 + 体检问题清单 + 带时间转写。 */
function buildRepairUserParts(note: Note, findings: ReadonlyArray<{ level: string; message: string }>, transcriptText: string): string {
  const problems = findings.filter((f) => f.level === 'warn').map((f, i) => `${i + 1}. ${f.message}`)
  return [
    '【体检发现的问题】',
    ...problems,
    '',
    '【当前笔记 JSON】',
    JSON.stringify(note),
    '',
    '【课程转写摘录】（修订的事实依据，不得超出这个范围）',
    transcriptText
  ].join('\n')
}

/**
 * 批3：一次有界返修。**不发图**——体检报的基本是「写短了 / 复读了标题 / 缺具体数字」
 * 这类问题，靠带时间的转写就能修；重发图片会让多模态费用接近翻倍。
 *
 * 返回 null 表示返修没能改善（调用失败 / 解析失败 / warn 数没下降），调用方保留原稿。
 * **门禁只用于内部提质，绝不用于拦截交付**——生成失败比一份及格的笔记更糟。
 */
async function repairOnce(
  client: OpenAiCompatibleClient,
  model: string,
  note: Note,
  findings: ReadonlyArray<{ level: string; message: string }>,
  transcriptText: string,
  segments: CleanSegment[],
  allRefs: ReadonlySet<string>,
  signal?: AbortSignal
): Promise<{ note: Note; stats: RefVerifyStats; warnCount: number; clamped: number } | null> {
  let answer: string
  try {
    answer = await client.chatJson(
      [
        { role: 'system', content: REPAIR_SYSTEM_PROMPT },
        { role: 'user', content: buildRepairUserParts(note, findings, transcriptText) }
      ],
      model,
      undefined,
      signal
    )
  } catch {
    return null
  }
  let repaired: Note
  try {
    repaired = parseNote(answer)
  } catch {
    try {
      repaired = parseNote(stripFences(answer))
    } catch {
      return null
    }
  }
  // 返修稿同样过证据过滤与摘引核验——返修不能成为编造的后门。
  const { note: evidenceChecked } = dropUnknownEvidence(repaired, allRefs)
  const verified = verifyNoteRefs(evidenceChecked, segments)
  // B4: 返修稿同样钳制越界 at（模型返修时可能再次外推时间）。
  const { note: clamped, clamped: clampedCount } = clampNoteTimes(verified.note, segments)
  return { note: clamped, stats: verified.stats, warnCount: noteHealth(clamped).warnCount, clamped: clampedCount }
}

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
  // 批5: MAX→INSERT→DELETE 收进一个事务——版本号的计算与落盘必须原子，
  // 半途失败要么整条回滚（下次重算同一版本号），绝不留下半个版本行。
  const insertVersion = db.transaction((): number => {
    const versionRow = db.prepare('SELECT MAX(version) AS v FROM notes WHERE lesson_id = ?').get(lessonId) as { v: number | null }
    const version = (versionRow.v ?? 0) + 1
    // 批3: 记下产出这份笔记的工艺版本，存量升级入口据此判断「要不要建议重生成」。
    db.prepare(
      'INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at, prompt_version, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      `${lessonId}-v${version}`,
      lessonId,
      version,
      JSON.stringify(note),
      'openai-compatible',
      model,
      new Date().toISOString(),
      CURRENT_PROMPT_VERSION,
      CURRENT_SCHEMA_VERSION
    )
    // F6 (design-review): keep only the newest KEEP_VERSIONS rows — regeneration
    // and polish append versions, and the table grew without bound before this.
    db.prepare('DELETE FROM notes WHERE lesson_id = ? AND version <= ?').run(lessonId, version - KEEP_VERSIONS)
    return version
  })
  return insertVersion()
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
      /** A1: false = 绑定模型无视觉能力，本次未发图（画面靠时间就近对齐）。 */
      visionCapable: boolean
      hitRate: { hits: number; total: number }
      /** Transcript-anchor hit rate (null when there was nothing to judge). */
      transcriptHitRate: { hits: number; total: number } | null
      refStats: RefVerifyStats
      droppedRefs: number
      /** 批3: 归一层各字段的丢弃计数（空对象 = 一项没丢）。 */
      normalizationDropped: NormalizationDropCounts
      /** B4: at 超出转写范围被钳到上界的时间字段数。 */
      clampedTimes: number
      /** B2: 金句核验（可核验/总数；无金句时 0/0）。 */
      quotesVerified: { total: number; verified: number }
      /** A3: 本课时真实画面素材数（0 = 断供，toast/体检据此说明原因）。 */
      visualAssets: { keyframes: number; ppt: number }
      /** 批3: 生成闭环结果——返修后的体检结果与是否真的返修过。 */
      health: {
        warnCount: number
        grade: 'good' | 'fair' | 'weak'
        repaired: boolean
        /** 返修前的 warn 数（未返修时为 null）。 */
        warnCountBeforeRepair: number | null
      }
    }
  | { error: string }
> {
  const binding = db.prepare("SELECT model FROM capability_bindings WHERE capability = 'multimodal'").get() as
    | { model: string }
    | undefined
  if (binding == null) return { error: '未绑定多模态模型，请在设置中配置' }
  const inputs = loadSummarizeInputs(db, lessonId, libraryRoot)
  if ('error' in inputs) return { error: inputs.error }
  // A1: 模型无视觉能力 → 不发图。省 token、省一次 unsupported_visual 静默重发
  // 的整段时长（2026-09-19 实测：74 分钟任务的 summarizing 阶段因此翻倍撞 10 分钟
  // 超时）。未知模型保守发图——猜错的代价比白烧 token 更伤（丢画面）。
  const visionCapable = modelHasVision(binding.model) !== false
  const sentImages = visionCapable ? inputs.images : []
  try {
    const generated = await generateNote(client, binding.model, sourceHeader(db, lessonId) + inputs.transcriptText, sentImages, signal)
    // 批3: 归一层静默丢弃了哪些项——「模型没写」与「写了但被拦下」是两种问题。
    const normalizationDropped = generated.dropped
    // F2 (review) + batch 1: refs are validated against EVERY real attachment,
    // not just the ones that fit the token cap — the cap only limits what the
    // model sees, it must not turn a real citation into a "fabrication".
    const { note: evidenceChecked, dropped } = dropUnknownEvidence(generated.note, inputs.allRefs)
    // Batch 1: the transcript anchors are now verifiable — quotes that cannot
    // be found in the transcript are cleared, out-of-range times dropped.
    const verified = verifyNoteRefs(evidenceChecked, inputs.segments)
    // B4: timeline/transcriptRefs 的 at 超转写范围 → 钳到边界并计数（2026-09-19
    // 真实库实测：5/18 条时间线 at 超出视频本体最多 62 分钟）。
    const clampedStep = clampNoteTimes(verified.note, inputs.segments)
    let clampedTimes = clampedStep.clamped
    // Citation quality signals (roadmap 1.3 + batch 1): the compliance reading
    // deliberately uses the images actually sent — the model never saw the rest.
    const hitRate = evidenceHitRate(clampedStep.note, inputs.images)
    const transcriptHitRate = transcriptRefHitRate(verified.stats)

    // Batch 3: 生成质量闭环——体检发现缺口时做**一次**有界返修，不发图。
    // 只有当返修真的把 warn 数压下来才采纳（否则保留原稿），所以这条路只可能
    // 改善、不可能变差；且无论结果如何都照常出笔记（反门控）。
    let note = clampedStep.note
    // B2: 金句过同一套转写核验（越界铳制 + 摘引匹配不上清空 text）。
    const quoteCheck = verifyTranscriptRefs(note.quotes, inputs.segments)
    const quotesVerified = { total: quoteCheck.stats.quoted, verified: quoteCheck.stats.quotedVerified }
    note = { ...note, quotes: quoteCheck.refs }
    let stats = verified.stats
    let warnCountBefore = noteHealth(note, hitRate, transcriptHitRate).warnCount
    let repaired = false
    /** 返修前的 warn 数——只有真返修过才有值，用于把「返修改进了多少」暴露出来。 */
    let warnCountBeforeRepair: number | null = null
    if (warnCountBefore > 0) {
      const health = noteHealth(note, hitRate, transcriptHitRate)
      const attempt = await repairOnce(
        client,
        binding.model,
        note,
        health.findings,
        inputs.transcriptText,
        inputs.segments,
        inputs.allRefs,
        signal
      )
      if (attempt != null && attempt.warnCount < warnCountBefore) {
        note = attempt.note
        stats = attempt.stats
        clampedTimes += attempt.clamped
        warnCountBeforeRepair = warnCountBefore
        warnCountBefore = attempt.warnCount
        repaired = true
      }
    }

    const version = saveNoteVersion(db, lessonId, note, binding.model)
    return {
      version,
      images: sentImages.length,
      visionCapable,
      hitRate: evidenceHitRate(note, sentImages),
      quotesVerified,
      visualAssets: inputs.visualAssets,
      transcriptHitRate: transcriptRefHitRate(stats),
      refStats: stats,
      droppedRefs: dropped,
      /** 批3: 归一层各字段的丢弃计数（空对象 = 一项没丢）。 */
      normalizationDropped,
      /** B4: 被钳到转写范围上界的时间字段数（0 = 模型没有外推时间）。 */
      clampedTimes,
      health: {
        warnCount: warnCountBefore,
        grade: noteHealth(note).grade,
        repaired,
        /** 返修前的 warn 数（未返修时为 null），便于展示「返修把 N 项改进到 M 项」。 */
        warnCountBeforeRepair
      }
    }
  } catch (err) {
    return { error: `笔记生成失败: ${(err as Error).message}` }
  }
}
