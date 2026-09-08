/**
 * 批2 (plan 2026-09-08 note-quality-overhaul): 转写清洗——喂给模型的素材提质。
 * 纯函数、load 时派生：原始 segments 落库不动，summarize/polish/qa 三个
 * 消费点统一走清洗后文本。真实库探针实证（2026-09-08）：ASR 满篇独立
 * 语气词（呃/嗯/啊/是吧），偶发近空段（120s 分片只剩「嗯。」）。
 * 不做术语纠错——模型侧关键帧交叉验证（质量批1 §9.6）已实证有效，规则
 * 清洗反而有误杀风险。
 */

/** One raw transcript segment（at 不参与清洗，字段可选以便调用方直传）。 */
export interface RawSegment {
  text?: string
}

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

/** 字符 bigram Dice 系数：ASR 偶发重复输出的相邻段相似度远超 0.85。 */
function bigramDice(left: string, right: string): number {
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
 * → 相邻高度相似去重 → '\n' 拼接。非相邻的重复内容保留（课程合法回顾）。
 */
export function cleanTranscript(segments: RawSegment[]): string {
  const cleaned: string[] = []
  for (const segment of segments) {
    const text = stripFillers(typeof segment.text === 'string' ? segment.text : '')
    if (text.length < NEAR_EMPTY_CHARS) continue
    const previous = cleaned[cleaned.length - 1]
    if (previous != null && isDuplicate(previous, text)) continue
    cleaned.push(text)
  }
  return cleaned.join('\n')
}
