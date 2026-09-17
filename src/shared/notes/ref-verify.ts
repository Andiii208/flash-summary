/**
 * 转写锚核验（批1, plan 2026-09-17 note-quality-upgrade）。
 *
 * 起因：素材层此前把 `segments_json` 里的 `at` 整个丢掉（`cleanTranscript` 只取
 * text），而 prompt 却要求模型输出**精确到秒的 `at`** 与「转写原文的忠实摘引」
 * （`summarize.ts` 规则 1 与 9.2）。无从核验的信息，模型只能编——「evidence 引用
 * 遵循度弱」被反复记成观察项却不改善，根因在此。
 *
 * 批1 起转写带 `[mm:ss]` 时间锚，于是 refs 第一次可以被机械核验。本模块是纯函数，
 * 落在 shared 供 main（生成后清理）与体检共用。
 *
 * 核验失败一律**降级而非报错**（与 `dropUnknownEvidence` 同纪律）：
 *   - `at` 落在真实转写范围外 → 丢弃该 ref（定位是假的）
 *   - `text` 匹配不上转写 → 清空 `text`、保留 `at`（退化为「定位到该分钟」）
 *   - 时间线条目的 `refs.at` 离条目 `at` 太远 → 只记数（诊断），不改数据
 */
import { bigramDice, TIME_WINDOW_SECONDS } from './transcript-clean'
import type { CleanSegment } from './transcript-clean'
import type { Note, TranscriptRef } from './schema'

/**
 * 时间线条目的 `refs[].at` 应落在条目 `at` 的邻域内（规则 9.7 的 few-shot 曾
 * 示范 `at:750` 配 `refs.at:10`，在教「ref 的时间与条目无关」）。
 * 默认 120s = SEU 的 ASR 分片粒度；B站字幕可传更窄的值。
 */
export const REF_NEIGHBORHOOD_SECONDS = 120

/** 摘引相似度下限。刻意放宽——规则 9.2 允许摘引时去掉口语语气词。 */
export const MIN_QUOTE_SIMILARITY = 0.7

/** 短于此长度的摘引不做「包含」判断：太短无从区分。 */
const MIN_CONTAINMENT_CHARS = 6

/** 核验统计——既进体检，也作为 `transcriptRefHitRate` 的分子分母。 */
export interface RefVerifyStats {
  /** 检查过的 ref 总数（timeline + concepts + formulasAndSteps）。 */
  total: number
  /** `at` 落在真实转写范围外、被整条丢弃的数量。 */
  droppedAt: number
  /** 摘引匹配不上转写、被清空 text 的数量。 */
  clearedText: number
  /** 带非空摘引的 ref 数（命中率的分母）。 */
  quoted: number
  /** 摘引能在转写里找到的 ref 数（命中率的分子）。 */
  quotedVerified: number
  /** 时间线 ref 的时间离条目时间过远的数量（诊断，不改数据）。 */
  offNeighborhood: number
}

export interface RefVerifyOptions {
  /** 邻域宽度（秒）。默认 {@link REF_NEIGHBORHOOD_SECONDS}。 */
  neighborhoodSeconds?: number
  /** 摘引相似度下限。默认 {@link MIN_QUOTE_SIMILARITY}。 */
  minQuoteSimilarity?: number
}

export interface RefVerifyResult {
  note: Note
  stats: RefVerifyStats
}

/** 归一化：去掉空白与标点，只留下可比对的内容字符。 */
export function normalizeForMatch(text: string): string {
  return text.replace(/[\s，。？！；：、,.?!;:'"“”‘’()（）[\]【】<>《》-]/g, '')
}

/**
 * 摘引是否能在转写里找到。三路判据，任一路通过即算命中：
 *   1. 归一化后是全文子串（模型直接摘引）；
 *   2. 与某个分片高度相似（模型在分片内做了删减）；
 *   3. 与全文中同长度滑窗的最大相似度过线（摘引跨了分片边界）。
 * 收紧到单一路径会误杀合法的省略式摘引，所以三路都留。
 */
export function quoteMatchesTranscript(quote: string, segments: ReadonlyArray<CleanSegment>): boolean {
  if (quote.length < MIN_CONTAINMENT_CHARS) return false
  const segmentTexts = segments.map((segment) => normalizeForMatch(segment.text)).filter((text) => text !== '')
  if (segmentTexts.length === 0) return false
  const joined = segmentTexts.join('')
  if (joined.includes(quote)) return true
  for (const text of segmentTexts) {
    if (bigramDice(quote, text) >= MIN_QUOTE_SIMILARITY) return true
  }
  return bestWindowSimilarity(quote, joined) >= MIN_QUOTE_SIMILARITY
}

/** 同长度滑窗的最大 bigram Dice（步长取半个引文长，够细且不爆算力）。 */
function bestWindowSimilarity(quote: string, joined: string): number {
  const width = quote.length
  if (joined.length < width) return 0
  const step = Math.max(1, Math.floor(width / 2))
  let best = 0
  for (let start = 0; start + width <= joined.length; start += step) {
    const score = bigramDice(quote, joined.slice(start, start + width))
    if (score > best) best = score
    if (best >= MIN_QUOTE_SIMILARITY) return best
  }
  return best
}

/** 真实转写的时间范围：`at` 的上下界，上界放宽一个时间窗（末段覆盖的时长）。 */
function transcriptRange(segments: ReadonlyArray<CleanSegment>): { max: number } | null {
  let max = Number.NEGATIVE_INFINITY
  for (const segment of segments) {
    if (segment.at != null && segment.at > max) max = segment.at
  }
  if (max === Number.NEGATIVE_INFINITY) return null
  return { max: max + TIME_WINDOW_SECONDS }
}

function verifyRefs(
  refs: TranscriptRef[],
  segments: ReadonlyArray<CleanSegment>,
  range: { max: number } | null,
  parentAt: number | null,
  stats: RefVerifyStats,
  options: Required<RefVerifyOptions>
): TranscriptRef[] {
  const kept: TranscriptRef[] = []
  for (const ref of refs) {
    stats.total += 1
    // 无时间锚的旧素材：判不了 at，不做此项核验（保持向后兼容）。
    if (range != null && (ref.at < 0 || ref.at > range.max)) {
      stats.droppedAt += 1
      continue
    }
    const quote = normalizeForMatch(ref.text)
    if (quote === '') {
      kept.push(ref)
    } else {
      stats.quoted += 1
      if (quoteMatchesTranscript(quote, segments)) {
        stats.quotedVerified += 1
        kept.push(ref)
      } else {
        stats.clearedText += 1
        kept.push({ ...ref, text: '' })
      }
    }
    if (parentAt != null && Math.abs(ref.at - parentAt) > options.neighborhoodSeconds) {
      stats.offNeighborhood += 1
    }
  }
  return kept
}

/**
 * 核验整篇笔记的转写锚。返回新对象（不改入参），统计随结果带出。
 *
 * `segments` 必须是**清洗后**的分片（上游真正喂给模型的那一份），否则模型摘引的
 * 是我们没给过它的原文。
 */
export function verifyNoteRefs(
  note: Note,
  segments: ReadonlyArray<CleanSegment>,
  options: RefVerifyOptions = {}
): RefVerifyResult {
  const resolved: Required<RefVerifyOptions> = {
    neighborhoodSeconds: options.neighborhoodSeconds ?? REF_NEIGHBORHOOD_SECONDS,
    minQuoteSimilarity: options.minQuoteSimilarity ?? MIN_QUOTE_SIMILARITY
  }
  const stats: RefVerifyStats = { total: 0, droppedAt: 0, clearedText: 0, quoted: 0, quotedVerified: 0, offNeighborhood: 0 }
  const range = transcriptRange(segments)

  const timeline = note.timeline.map((entry) => {
    const refs = verifyRefs(entry.refs, segments, range, entry.at, stats, resolved)
    return { ...entry, refs }
  })
  const concepts = note.concepts.map((concept) => ({
    ...concept,
    refs: verifyRefs(concept.refs, segments, range, null, stats, resolved)
  }))
  const formulasAndSteps = note.formulasAndSteps.map((item) => ({
    ...item,
    refs: verifyRefs(item.refs, segments, range, null, stats, resolved)
  }))

  return { note: { ...note, timeline, concepts, formulasAndSteps }, stats }
}

/**
 * 转写锚命中率——与视觉锚的 `evidenceHitRate` 并列暴露。
 * 无摘引可判（分母 0）时返回 null，调用方隐藏徽标而不是除零。
 */
export function transcriptRefHitRate(stats: RefVerifyStats): { hits: number; total: number } | null {
  if (stats.quoted === 0) return null
  return { hits: stats.quotedVerified, total: stats.quoted }
}
