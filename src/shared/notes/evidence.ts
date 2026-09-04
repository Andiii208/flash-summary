/**
 * Evidence resolution (2026-09-04): map a structured note's evidence refs
 * onto the lesson's real attachments. Pure functions, shared by the
 * renderer and the PDF handout.
 *
 * Alignment strategy — three layers, degrade gracefully:
 *   1. exact ref match (`ppt:<page>` / `kf:<id>`) on the entry's evidence;
 *   2. timeline fallback: nearest keyframe by timestamp (≤ NEAREST_SECONDS);
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

/** Max |timeline.at − keyframe.at| for the nearest-keyframe fallback. */
export const NEAREST_SECONDS = 90

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

/** Images for a single timeline entry (evidence refs first, then nearest fallback). */
export function bindTimelineImages(
  entry: { at: number; evidence: EvidenceRef[] },
  attachments: AttachmentLike[]
): TimelineImage[] {
  const byRef = refIndex(attachments)
  const bound: TimelineImage[] = []
  const seen = new Set<string>()
  for (const evidence of entry.evidence) {
    const hit = byRef.get(evidence.ref)
    if (hit != null && !seen.has(hit.ref)) {
      seen.add(hit.ref)
      bound.push({ ref: hit.ref, dataUrl: hit.dataUrl, origin: 'evidence' })
    }
  }
  if (bound.length === 0) {
    const nearest = nearestKeyframe(entry.at, attachments)
    if (nearest != null) bound.push({ ref: nearest.ref, dataUrl: nearest.dataUrl, origin: 'nearest' })
  }
  return bound
}

/** Nearest keyframe within NEAREST_SECONDS of the given timestamp. */
export function nearestKeyframe(at: number, attachments: AttachmentLike[]): AttachmentLike | null {
  let best: AttachmentLike | null = null
  let bestDelta = NEAREST_SECONDS + 1
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

/** Format seconds as mm:ss (shared display helper). */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Best-effort transcript quote for an entry: the ref whose at is closest. */
export function quoteForEntry(entry: { at: number; refs: TranscriptRef[] }): TranscriptRef | null {
  if (entry.refs.length === 0) return null
  return entry.refs.reduce((best, ref) => (Math.abs(ref.at - entry.at) < Math.abs(best.at - entry.at) ? ref : best))
}
