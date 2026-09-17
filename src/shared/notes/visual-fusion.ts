/**
 * PPT × 关键帧视觉融合（批1, plan 2026-09-17 note-quality-upgrade）。
 *
 * 事实基础（已在代码里核实）：
 *   - 关键帧抽自 `screen/PPT stream`（`streams.ts` 的 `1170195-5`），**带时间**
 *     （文件名内嵌秒），但保真度低（JPEG 屏幕截图，可能只拍到半页或被批注遮挡）。
 *   - 平台 PPT 页来自 `/v1/course/ai/ppt?courseId=`（`school/client.ts:167`）——
 *     注意是 **courseId 而不是 lessonId**，所以 deck 是**整门课**的，并且
 *     `orchestrator` 把整套 deck 按同一个 lesson_id 存进**每一节课**。
 *   - 因此 PPT 页**没有时间**（`attachments.ts` 里 `ppt:N` 的 at 写死 null）。
 *
 * 两条通道拍的是同一块屏幕，所以天然可融合：
 *   ① **交叉去重**：关键帧与某张 PPT 页近乎相同 → 留 PPT 页（更清晰），该关键帧
 *      不必再发；与任何 PPT 页都不匹配的关键帧**必须全部保留**——那正是 PPT 里
 *      没有的信息（板书、现场演示、软件操作、讲者手写标注）。
 *   ② **给 PPT 反推时间**：匹配上的关键帧带时间戳、PPT 页有顺序，于是可以给
 *      PPT 页分配单调递增的时间轴。`ppt:N` 从此可以当**带时间的证据**引用，
 *      而不是「高保真但没时间」和「有时间但模糊」二选一。
 *   ③ **预算法**：不再按类型排序后 `slice(0,20)`。PPT 页只发**本课时真正用到
 *      的那些**（由匹配结果决定，这正是课程级 deck 必须靠匹配筛选的原因），
 *      关键帧按时间覆盖采样；超预算时**绝不砍 PPT 页**。
 *
 * 本模块是纯函数（只吃已经算好的哈希），便于单测；解码在 main 侧完成。
 */
import { hammingDistance } from '../phash'

/** 一条候选视觉素材。 */
export interface VisualCandidate {
  ref: string
  kind: 'ppt' | 'keyframe'
  /** 秒；PPT 页为 null（平台不给时间）。 */
  at: number | null
  /**
   * 8x8 平均哈希（见 `shared/phash.ts`）。**null = 解码失败**：不参与匹配判断，
   * 因而既撞不掉别人、也不会被别人撞掉。两条通道对它的处置刻意相反——
   * 关键帧照发（少发图是回归，宁可多发一张），PPT 页不发（它是课程级 deck，
   * 无法确认本讲是否用到，发出去就是把别的课时的幻灯片灌进这一节）。
   */
  hash: string | null
}

export interface VisualFusionOptions {
  /** 发送预算（张）。 */
  maxImages: number
  /**
   * 跨源「近乎相同」的汉明距离上限。刻意**小于**帧内去重用的 5：annotated 过的
   * 幻灯片亮度分布会明显偏离原页，用紧阈值才符合「近乎相同」的语义——松阈值会
   * 把「带讲者标注的关键帧」误判为冗余而丢掉。
   */
  duplicateDistance?: number
}

export interface VisualFusionResult {
  /** 要发送的 ref，按发送顺序（PPT 在前、关键帧在后，与既有实现同序）。 */
  selected: string[]
  /** `ppt:N` → 首次出现的秒数（推断值，非实测）。 */
  inferredTimes: Map<string, number>
  /** 被判为「与某张 PPT 页重复」而不再发送的关键帧 ref。 */
  redundantKeyframes: string[]
  /** 命中了 PPT 页的关键帧 ref（时间推断的依据）。 */
  matchedKeyframes: string[]
  /** 与任何 PPT 页都不匹配的关键帧 ref——PPT 之外的独有信息。 */
  uniqueKeyframes: string[]
}

/** 默认跨源重复阈值。 */
export const CROSS_SOURCE_DUPLICATE_DISTANCE = 3

/**
 * 在两个候选集合之间找最近的 PPT 页（同一哈希空间，汉明距离 ≤ 阈值才算命中）。
 * 同距离时取**页序更靠前**的那张：同一页被多次拍摄的概率高于跨页误判。
 */
function nearestPpt(candidate: VisualCandidate, ppts: ReadonlyArray<VisualCandidate>, limit: number): VisualCandidate | null {
  if (candidate.hash == null) return null
  let best: VisualCandidate | null = null
  let bestDistance = limit + 1
  for (const ppt of ppts) {
    if (ppt.hash == null) continue
    const distance = hammingDistance(ppt.hash, candidate.hash)
    if (distance <= limit && distance < bestDistance) {
      best = ppt
      bestDistance = distance
    }
  }
  return best
}

/** 沿时间轴等距采样，恰好返回 limit 个（items 多于 limit 时索引严格递增，不重复）。 */
function sampleEvenly<T>(items: ReadonlyArray<T>, limit: number): T[] {
  if (limit <= 0) return []
  if (items.length <= limit) return [...items]
  const picked: T[] = []
  for (let i = 0; i < limit; i++) {
    picked.push(items[Math.floor((i * items.length) / limit)] as T)
  }
  return picked
}

export function fuseVisualEvidence(
  candidates: ReadonlyArray<VisualCandidate>,
  options: VisualFusionOptions
): VisualFusionResult {
  const limit = options.duplicateDistance ?? CROSS_SOURCE_DUPLICATE_DISTANCE
  const ppts = candidates.filter((c) => c.kind === 'ppt')
  const keyframes = [...candidates].filter((c) => c.kind === 'keyframe').sort((a, b) => (a.at ?? 0) - (b.at ?? 0))

  const inferredTimes = new Map<string, number>()
  const redundantKeyframes: string[] = []
  const matchedKeyframes: string[] = []
  const uniqueKeyframes: string[] = []

  for (const keyframe of keyframes) {
    // 解码失败的关键帧一律当「独有信息」照发——匹配不可信时不能替它做减法。
    const match = keyframe.hash == null ? null : nearestPpt(keyframe, ppts, limit)
    if (match == null) {
      uniqueKeyframes.push(keyframe.ref)
      continue
    }
    matchedKeyframes.push(keyframe.ref)
    redundantKeyframes.push(keyframe.ref)
    // 首次出现的时刻即该页在本讲的时间（推断，不是实测）。
    if (keyframe.at != null && !inferredTimes.has(match.ref)) inferredTimes.set(match.ref, keyframe.at)
  }

  // 本课时真正用到的 PPT 页 = 被匹配上的那些。课程级 deck 里其余页属于别的课时，
  // 不能发（否则每节课都被灌进整门课的幻灯片）。
  const matchedPpts = ppts
    .filter((p) => inferredTimes.has(p.ref))
    .sort((a, b) => (inferredTimes.get(a.ref) as number) - (inferredTimes.get(b.ref) as number))
  // 兜底：一张都没匹配上 ≡ 匹配没有产出信息（没有关键帧可比对，或分辨率/画幅导致
  // 哈希对不齐）。此时不能拿「没匹配」当「没用到」——退回按页序均匀采样**全部**
  // PPT 页（含解码失败的），否则会把整个 PPT 通道静默丢掉，比融合前还差。
  const pptsToSend = matchedPpts.length > 0 ? matchedPpts : sampleEvenly(ppts, options.maxImages)

  const budget = Math.max(0, options.maxImages)
  if (pptsToSend.length + uniqueKeyframes.length <= budget) {
    return {
      selected: [...pptsToSend.map((p) => p.ref), ...uniqueKeyframes],
      inferredTimes,
      redundantKeyframes,
      matchedKeyframes,
      uniqueKeyframes
    }
  }

  // 超预算：两边各分一半，谁用不满就把余额让给另一方（两趟饱和，保证不浪费配额）。
  // 独有信息的价值更稀缺，PPT 页的保真度更高——均分是能同时守住两者的最简规则。
  const keyframeQuota = Math.min(uniqueKeyframes.length, Math.ceil(budget / 2))
  const pptQuota = Math.min(pptsToSend.length, budget - keyframeQuota)
  const keyframeQuotaFinal = Math.min(uniqueKeyframes.length, budget - pptQuota)
  const pptQuotaFinal = Math.min(pptsToSend.length, budget - keyframeQuotaFinal)
  const pptPicked = sampleEvenly(pptsToSend, pptQuotaFinal)
  const keyframePicked = sampleEvenly(uniqueKeyframes, Math.min(keyframeQuotaFinal, budget - pptPicked.length))

  return {
    selected: [...pptPicked.map((p) => p.ref), ...keyframePicked],
    inferredTimes,
    redundantKeyframes,
    matchedKeyframes,
    uniqueKeyframes
  }
}
