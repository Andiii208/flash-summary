/**
 * 批2 (plan 2026-09-08 note-quality-overhaul): 转写清洗——喂给模型的素材提质。
 * 纯函数、load 时派生：原始 segments 落库不动，summarize/polish/qa 三个
 * 消费点统一走清洗后文本。真实库探针实证（2026-09-08）：ASR 满篇独立
 * 语气词（呃/嗯/啊/是吧），偶发近空段（120s 分片只剩「嗯。」）。
 * 不做术语纠错——模型侧关键帧交叉验证（质量批1 §9.6）已实证有效，规则
 * 清洗反而有误杀风险。
 *
 * 批1 (plan 2026-09-17 note-quality-upgrade): 清洗结果保留 `at`，并新增
 * `cleanTranscriptTimed` 产出 `[mm:ss]` 时间锚——此前时间被整个丢弃，模型
 * 却要输出精确秒级 `at` 与「忠实摘引」。
 */
import { formatTime } from './format'

/** One raw transcript segment（at 不参与清洗，字段可选以便调用方直传）。 */
export interface RawSegment {
  /** Seconds from lesson start. Absent on legacy/hand-made input. */
  at?: number
  text?: string
}

/** A cleaned segment — text after filler/empty/duplicate removal, `at` carried through. */
export interface CleanSegment {
  at?: number
  text: string
}

/**
 * 时间锚窗宽（批1, plan 2026-09-17 note-quality-upgrade batch 1)。素材层此前把 `at`
 * 整个丢掉，模型却要输出精确到秒的 `at` 与「忠实摘引」——无从核验，只能编。
 *
 * 窗口同时解决两件事：SEU 的 ASR 分片是 120s（`openai-client.ts`「≤120s audio」），
 * 落在 30s 桶里各占一格、时间不变；B站字幕是逐句 cue（约 2-3.5s/条，见
 * `tests/bilibili-client.test.ts`），45 分钟上千条，逐条打时间戳会让每课多出约
 * 一万字符——按窗合流后收敛到 ~90 条。
 */
export const TIME_WINDOW_SECONDS = 30

/** 句尾/标点前位置的自由语气词。 */
const FILLER = '(?:呃|嗯|啊|是吧|对吧|好吧)'
/**
 * 语气词合法的右侧边界：标点、空白或串尾。左侧刻意不设界——「大家好啊」
 * 的啊同为语气词，而中文几乎不存在以呃/嗯/啊为词内语素的词；词内不受
 * 影响的保证来自右边界（词内字后不紧跟标点）。
 */
const FILLER_AT_BOUNDARY = new RegExp(`${FILLER}(?=[，。？！；：、,.?!;:\\s]|$)`, 'g')
/** 清洗可能留下的重复标点（「好，呃，好」→「好，，好」）。 */
const DUPLICATE_PUNCT = /([，。？！；：、,.?!;:])\1+/g
const LEADING_PUNCT = /^[，。？！；：、,.?!;:\s]+/
const TRAILING_PUNCT = /[，。？！；：、,.?!;:\s]+$/

/** 压缩一段文本里的独立语气词（循环替换处理连续语气词，如「呃嗯，」）。 */
export function stripFillers(text: string): string {
  let current = text
  let previous = ''
  while (current !== previous) {
    previous = current
    current = current.replace(FILLER_AT_BOUNDARY, '')
  }
  return current.replace(DUPLICATE_PUNCT, '$1').replace(LEADING_PUNCT, '').replace(TRAILING_PUNCT, '').trim()
}

/** 相邻段去重只对长段启用相似度——短段（B站字幕行）仅精确相等去重。 */
const MIN_SIMILARITY_CHARS = 20
const NEAR_EMPTY_CHARS = 5
const DUPLICATE_SIMILARITY = 0.85

/** 字符 bigram Dice 系数：ASR 偶发重复输出的相邻段相似度远超 0.85。
 *  导出复用（批3 体检的「detail 复读标题」启发式共用同一几何）。 */
export function bigramDice(left: string, right: string): number {
  if (left === right) return 1
  const leftGrams = new Set<string>()
  for (let i = 0; i < left.length - 1; i++) leftGrams.add(left.slice(i, i + 2))
  const rightGrams = new Set<string>()
  for (let i = 0; i < right.length - 1; i++) rightGrams.add(right.slice(i, i + 2))
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0
  let shared = 0
  for (const gram of leftGrams) if (rightGrams.has(gram)) shared++
  return (2 * shared) / (leftGrams.size + rightGrams.size)
}

function isDuplicate(previous: string, text: string): boolean {
  if (previous === text) return true
  if (previous.length < MIN_SIMILARITY_CHARS || text.length < MIN_SIMILARITY_CHARS) return false
  return bigramDice(previous, text) >= DUPLICATE_SIMILARITY
}

/**
 * 清洗后拼接：语气词压缩 → 近空段剔除（清洗后 <5 字，如整段只剩「嗯。」）
 * → 相邻高度相似去重。非相邻的重复内容保留（课程合法回顾）。
 *
 * `at` 原样带出（不参与清洗判断）——批1 起上游需要时间锚。
 */
export function cleanSegments(segments: RawSegment[]): CleanSegment[] {
  const cleaned: CleanSegment[] = []
  for (const segment of segments) {
    const text = stripFillers(typeof segment.text === 'string' ? segment.text : '')
    if (text.length < NEAR_EMPTY_CHARS) continue
    const previous = cleaned[cleaned.length - 1]
    if (previous != null && isDuplicate(previous.text, text)) continue
    const at = typeof segment.at === 'number' && Number.isFinite(segment.at) ? segment.at : undefined
    cleaned.push(at == null ? { text } : { at, text })
  }
  return cleaned
}

/** 纯文本拼接（无时间锚）——qa/旧调用方与既有测试的口径。 */
export function cleanTranscript(segments: RawSegment[]): string {
  return cleanSegments(segments)
    .map((segment) => segment.text)
    .join('\n')
}

/**
 * 带时间锚的拼接（批1）：按 `TIME_WINDOW_SECONDS` 合流后，每窗一行
 * `[mm:ss] 文本`，窗外/无 at 的段退化为纯文本行。
 *
 * 行首时间取该窗**首段的真实 at**（而非桶起点），这样 B站字幕保留秒级精度、
 * SEU 各分片仍落在自己的桶里——两种粒度的锚点都诚实。
 */
export function formatTimedTranscript(segments: ReadonlyArray<CleanSegment>): string {
  const lines: string[] = []
  let windowKey: number | null = null
  let windowAt: number | null = null
  let windowTexts: string[] = []
  const flush = (): void => {
    if (windowTexts.length === 0) return
    const body = windowTexts.join(' ')
    lines.push(windowAt == null ? body : `[${formatTime(windowAt)}] ${body}`)
    windowTexts = []
  }
  for (const segment of segments) {
    if (segment.at == null) {
      flush()
      windowKey = null
      windowAt = null
      lines.push(segment.text)
      continue
    }
    const key = Math.floor(segment.at / TIME_WINDOW_SECONDS)
    if (windowKey != null && key !== windowKey) flush()
    if (windowTexts.length === 0) windowAt = segment.at
    windowKey = key
    windowTexts.push(segment.text)
  }
  flush()
  return lines.join('\n')
}

/** 便捷入口：清洗 + 时间锚一次到位（polish / qa 等只取文本的消费点）。 */
export function cleanTranscriptTimed(segments: RawSegment[]): string {
  return formatTimedTranscript(cleanSegments(segments))
}

/**
 * 长转写的**全域采样**（批3, plan 2026-09-17 item 5）：超预算时不再只截前 N 字符。
 *
 * 起因：polish / qa 此前都是 `text.slice(0, 24000)`——45 分钟以上的课，后半段对模型
 * 完全不存在，于是「按反馈补细节」只能拿前半段的素材硬凑。改为**逐行按步长抽稀**，
 * 预算内覆盖整节课的首、中、尾，而不是只要开头。
 *
 * 抽稀是确定性的（不随机），因此可测、可回归。
 */
export function sampleTranscriptLines(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const total = lines.reduce((acc, line) => acc + line.length + 1, 0)
  // 步长使「抽出的行总长约等于预算」——上下文越长，抽得越稀，但覆盖面不变。
  const step = Math.max(1, Math.ceil(total / maxChars))
  const kept: string[] = []
  let used = 0
  for (let i = 0; i < lines.length; i += step) {
    const line = lines[i] as string
    if (used + line.length + 1 > maxChars) break
    kept.push(line)
    used += line.length + 1
  }
  // 头尾保底：抽稀后若首行或末行没被采样到，补上——「本讲从哪开始、讲到哪结束」
  // 是最不该丢的两端。
  const first = lines[0] as string
  const last = lines[lines.length - 1] as string
  if (kept[0] !== first && used + first.length + 1 <= maxChars) {
    kept.unshift(first)
    used += first.length + 1
  }
  if (kept[kept.length - 1] !== last && used + last.length + 1 <= maxChars) kept.push(last)
  return kept.join('\n')
}
