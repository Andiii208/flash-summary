/**
 * Evidence resolution (2026-09-04): map a structured note's evidence refs
 * onto the lesson's real attachments. Pure functions, shared by the
 * renderer and the PDF handout.
 *
 * Alignment strategy — degrade gracefully (批 A5, plan 2026-09-19: the
 * per-entry 90s sieve became a cross-entry greedy 1:1 allocation):
 *   1. exact ref match (`ppt:<page>` / `kf:<id>`) on the entry's evidence;
 *   2. timeline allocation: greedy one-to-one pairing of the remaining
 *      entries with the uncited frames by |Δat| (adaptive tolerance, see
 *      {@link allocateTimelineImages});
 *   3. no attachment at all — the card renders text-only.
 */
import type { EvidenceRef, Note, TranscriptRef } from './schema'

/** Renderer-facing attachment descriptor (IPC carries the data URL). */
export interface AttachmentLike {
  /** Evidence id: `ppt:<page>` or `kf:<id>`. */
  ref: string
  kind: 'ppt' | 'keyframe'
  /** Seconds from lesson start; null for PPT pages (no timing on platform). */
  at: number | null
  /** base64 data URL for <img src> (CSP allows data:). */
  dataUrl: string
}

/** 批 A5：跨条目分配的容差上下界（唯一事实源， nearestKeyframe 与分配器共用下界）。 */
export const ALLOCATION_MIN_TOLERANCE_SECONDS = 120
export const ALLOCATION_MAX_TOLERANCE_SECONDS = 600

/** Images bound to one timeline entry, in display order. */
export interface TimelineImage {
  ref: string
  dataUrl: string
  /** Where the binding came from — shown as the card's caption hint. */
  origin: 'evidence' | 'nearest'
}

/** Exact-ref lookup table built once per lesson. */
function refIndex(attachments: AttachmentLike[]): Map<string, AttachmentLike> {
  return new Map(attachments.map((a) => [a.ref, a]))
}

/** Images for a single timeline entry (evidence refs first, then nearest fallback).
 *  批 A5 起委派给跨条目分配器的单条目形态（同一套判据，不再维护两份实现）。 */
export function bindTimelineImages(
  entry: { at: number; evidence: EvidenceRef[] },
  attachments: AttachmentLike[]
): TimelineImage[] {
  return allocateTimelineImages([entry], attachments)[0] ?? []
}

/** Closest keyframe by |Δ|, keyframes only, within the allocation floor. */
export function nearestKeyframe(at: number, attachments: AttachmentLike[]): AttachmentLike | null {
  let best: AttachmentLike | null = null
  let bestDelta = ALLOCATION_MIN_TOLERANCE_SECONDS + 1
  for (const a of attachments) {
    if (a.kind !== 'keyframe' || a.at == null) continue
    const delta = Math.abs(a.at - at)
    if (delta < bestDelta) {
      best = a
      bestDelta = delta
    }
  }
  return best
}

/** Gallery for the evidence view: every cited attachment, deduped, in note order. */
/** F4 (review): minimal per-ref shape carried by the attachment manifest. */
export interface AttachmentManifestEntry {
  ref: string
  at: number | null
  /** A6: 感知哈希（keyframes.hash）——图集按它折叠近重复帧。 */
  hash?: string
}

/** A lazy lookup the renderer supplies: undefined = still loading, null = resolved missing. */
export type AttachmentGetter = (ref: string) => AttachmentLike | null | undefined

/* ------------------------------------------------------------------ *
 * 批 A5（plan 2026-09-19-note-experience-overhaul）：跨条目贪心一对一分配。
 *
 * 旧机制是「每条目各自找 90s 内最近的帧」——帧距 >180s 时大面积落空。真实库实测
 * （2026-09-19，scripts/note-visual-audit.ts）：73.8 分钟视频 18 帧 18 条时间线，
 * 配图率只有 5/18=28%，因为 90s 是**筛子**而不是**分配器**。本模块把决策单位从
 * 「条目」换成「整份时间线」：
 *   1. evidence 精确引用照旧逐条绑定（显式主张优先级最高；被任一条目引用过的帧
 *      退出分配池，但多个条目引用同一帧仍各自显示——引用语义与旧行为一致）；
 *   2. 其余条目与剩余帧按 |Δat| **全局升序贪心配对**：每帧至多配一条、每条至多
 *      配一帧（18↔18 全部配上，稀缺帧优先给离得最近的那条）；
 *   3. 容差自适应 = clamp(2×帧距中位数, 120s, 600s)——帧稀时容差放宽，但承认
 *      配不上时（>600s）宁可文字卡，不把远处的帧说成「临近画面」。
 *
 * 分配是纯函数（只吃 ref/at），渲染层与 PDF 共用同一套判据：两个包装器分别服务
 * 懒加载（renderer）与已解析附件（PDF），判定不分化就不会漂移。
 * ------------------------------------------------------------------ */

interface FrameCandidate {
  ref: string
  at: number
}

/** 帧距中位数（排序后取中位；单帧无距 → 0）。 */
function medianFrameGap(frames: ReadonlyArray<FrameCandidate>): number {
  const times = frames.map((f) => f.at).sort((a, b) => a - b)
  if (times.length < 2) return 0
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1])
  gaps.sort((a, b) => a - b)
  const mid = gaps.length >> 1
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
}

function allocationTolerance(frames: ReadonlyArray<FrameCandidate>): number {
  return Math.min(
    ALLOCATION_MAX_TOLERANCE_SECONDS,
    Math.max(ALLOCATION_MIN_TOLERANCE_SECONDS, 2 * medianFrameGap(frames))
  )
}

interface PlannedBinding {
  entryIndex: number
  ref: string
  origin: 'evidence' | 'nearest'
}

/**
 * 分配计划（纯函数）：evidence 绑定 + 贪心一对一配对。`usable` 谓词区分两个包装器
 * 的「能否渲染」判定（附件已解析 / 懒加载是否到位），分配逻辑只有一份。
 */
function planAllocation(
  entries: ReadonlyArray<{ at: number; evidence: EvidenceRef[] }>,
  frames: ReadonlyArray<FrameCandidate>,
  usable: (ref: string) => boolean
): PlannedBinding[] {
  const frameRefs = new Set(frames.map((f) => f.ref))
  const plan: PlannedBinding[] = []
  const citedRefs = new Set<string>()

  // Pass 1: evidence 精确引用——逐条、按 note 序、条目内去重；不解析的引用不算绑定。
  entries.forEach((entry, entryIndex) => {
    const seen = new Set<string>()
    for (const evidence of entry.evidence) {
      if (!frameRefs.has(evidence.ref) || !usable(evidence.ref) || seen.has(evidence.ref)) continue
      seen.add(evidence.ref)
      citedRefs.add(evidence.ref)
      plan.push({ entryIndex, ref: evidence.ref, origin: 'evidence' })
    }
  })

  // Pass 2: 无 evidence 图像的条目 × 未被引用且可渲染的帧，按 |Δat| 全局升序贪心。
  const satisfies = new Set<number>()
  for (const binding of plan) satisfies.add(binding.entryIndex)
  const citedRefsUsed = new Set<string>(citedRefs)
  const tolerance = allocationTolerance(frames)
  const pairs: Array<{ delta: number; entryIndex: number; ref: string }> = []
  entries.forEach((entry, entryIndex) => {
    if (satisfies.has(entryIndex)) return
    for (const frame of frames) {
      if (citedRefsUsed.has(frame.ref) || !usable(frame.ref)) continue
      const delta = Math.abs(entry.at - frame.at)
      if (delta <= tolerance) pairs.push({ delta, entryIndex, ref: frame.ref })
    }
  })
  pairs.sort((a, b) => a.delta - b.delta || a.entryIndex - b.entryIndex || (a.ref < b.ref ? -1 : 1))
  for (const pair of pairs) {
    // 帧一旦被更近的条目拿走就不再可用；条目已满足也跳过——一对一的两边守卫。
    if (satisfies.has(pair.entryIndex) || citedRefsUsed.has(pair.ref)) continue
    citedRefsUsed.add(pair.ref)
    satisfies.add(pair.entryIndex)
    plan.push({ entryIndex: pair.entryIndex, ref: pair.ref, origin: 'nearest' })
  }
  return plan
}

/** 把分配计划归集成「每条目一组图」（顺序即输入顺序）。 */
function collectPlan(
  plan: ReadonlyArray<PlannedBinding>,
  count: number,
  materialize: (ref: string) => { ref: string; dataUrl: string } | null
): TimelineImage[][] {
  const out: TimelineImage[][] = Array.from({ length: count }, () => [])
  for (const binding of plan) {
    const image = materialize(binding.ref)
    if (image == null) continue
    out[binding.entryIndex].push({ ...image, origin: binding.origin })
  }
  return out
}

/** 跨条目分配（已解析附件）——PDF 讲义与单条目兼容入口共用。 */
export function allocateTimelineImages(
  entries: ReadonlyArray<{ at: number; evidence: EvidenceRef[] }>,
  attachments: AttachmentLike[]
): TimelineImage[][] {
  const byRef = refIndex(attachments)
  const frames: FrameCandidate[] = attachments
    .filter((a): a is AttachmentLike & { at: number } => a.at != null)
    .map((a) => ({ ref: a.ref, at: a.at }))
  const plan = planAllocation(entries, frames, (ref) => byRef.has(ref))
  return collectPlan(plan, entries.length, (ref) => {
    const hit = byRef.get(ref)
    return hit == null ? null : { ref: hit.ref, dataUrl: hit.dataUrl }
  })
}

/**
 * 跨条目分配（懒加载）——renderer 的时间线卡片用。`get(ref)` 返回 undefined（还在
 * 加载）时该帧本轮不参与分配；附件解析完成后 version bump 会重算，最终态与
 * 「附件已解析」形态一致。判定与 {@link allocateTimelineImages} 同一份 planAllocation。
 */
export function allocateTimelineImagesLazy(
  entries: ReadonlyArray<{ at: number; evidence: EvidenceRef[] }>,
  get: AttachmentGetter,
  manifest: ReadonlyArray<AttachmentManifestEntry>
): TimelineImage[][] {
  const frames: FrameCandidate[] = manifest
    .filter((m): m is AttachmentManifestEntry & { at: number } => m.at != null)
    .map((m) => ({ ref: m.ref, at: m.at }))
  const plan = planAllocation(entries, frames, (ref) => get(ref) != null)
  return collectPlan(plan, entries.length, (ref) => {
    const hit = get(ref)
    return hit == null ? null : { ref: hit.ref, dataUrl: hit.dataUrl }
  })
}

export function resolveEvidenceGalleryLazy(
  note: Note,
  get: AttachmentGetter,
  manifest: ReadonlyArray<AttachmentManifestEntry>
): TimelineImage[] {
  const gallery: TimelineImage[] = []
  const seen = new Set<string>()
  const push = (ref: string): void => {
    if (seen.has(ref)) return
    const hit = get(ref)
    if (hit == null) return
    seen.add(ref)
    gallery.push({ ref: hit.ref, dataUrl: hit.dataUrl, origin: 'evidence' })
  }
  for (const entry of note.timeline) for (const evidence of entry.evidence) push(evidence.ref)
  for (const evidence of note.evidence) push(evidence.ref)
  // Uncited keyframes still have study value — append the rest, time-ordered.
  for (const entry of [...manifest].sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity))) {
    push(entry.ref)
  }
  return gallery
}

export function resolveEvidenceGallery(note: Note, attachments: AttachmentLike[]): TimelineImage[] {
  const byRef = refIndex(attachments)
  const gallery: TimelineImage[] = []
  const seen = new Set<string>()
  const push = (evidence: EvidenceRef): void => {
    const hit = byRef.get(evidence.ref)
    if (hit != null && !seen.has(hit.ref)) {
      seen.add(hit.ref)
      gallery.push({ ref: hit.ref, dataUrl: hit.dataUrl, origin: 'evidence' })
    }
  }
  for (const entry of note.timeline) for (const evidence of entry.evidence) push(evidence)
  for (const evidence of note.evidence) push(evidence)
  // Uncited keyframes still have study value — append the rest, time-ordered.
  for (const a of [...attachments].sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity))) {
    if (!seen.has(a.ref)) {
      seen.add(a.ref)
      gallery.push({ ref: a.ref, dataUrl: a.dataUrl, origin: 'nearest' })
    }
  }
  return gallery
}

/**
 * Evidence citation hit rate (2026-09-04, roadmap 1.3): of the unique refs
 * the model cited on timeline entries, how many resolve to a real attachment.
 * Denominator 0 (no cited evidence) yields {hits:0,total:0} — callers hide
 * the badge rather than divide by zero.
 */
export function evidenceHitRate(
  note: Pick<Note, 'timeline'>,
  attachments: ReadonlyArray<Pick<AttachmentLike, 'ref'>>
): { hits: number; total: number } {
  const known = new Set(attachments.map((a) => a.ref))
  const cited = new Set<string>()
  for (const entry of note.timeline) for (const evidence of entry.evidence) cited.add(evidence.ref)
  let hits = 0
  for (const ref of cited) if (known.has(ref)) hits += 1
  return { hits, total: cited.size }
}

/**
 * F2 (review 2026-09-05): models fabricate refs in the RIGHT SHAPE (the
 * regex only checks form). Before persisting, drop evidence refs that do
 * not resolve against the lesson's real evidence set — the renderer's
 * nearest-fallback then shows an honest «就近» image instead of a silently
 * dead citation. Text content is never touched.
 */
export function dropUnknownEvidence(note: Note, validRefs: ReadonlySet<string>): { note: Note; dropped: number } {
  let dropped = 0
  const timeline = note.timeline.map((entry) => {
    const evidence = entry.evidence.filter((e) => {
      if (validRefs.has(e.ref)) return true
      dropped++
      return false
    })
    return evidence === entry.evidence ? entry : { ...entry, evidence }
  })
  const topEvidence = note.evidence.filter((e) => {
    if (validRefs.has(e.ref)) return true
    dropped++
    return false
  })
  return { note: { ...note, timeline, evidence: topEvidence }, dropped }
}

// F7 (review): single implementation lives in ./format - re-export keeps
// existing import paths stable.
export { formatTime } from './format'

/** Best-effort transcript quote for an entry: the ref whose at is closest. */
export function quoteForEntry(entry: { at: number; refs: TranscriptRef[] }): TranscriptRef | null {
  if (entry.refs.length === 0) return null
  return entry.refs.reduce((best, ref) => (Math.abs(ref.at - entry.at) < Math.abs(best.at - entry.at) ? ref : best))
}
