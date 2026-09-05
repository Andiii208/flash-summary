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
/** F4 (review): minimal per-ref shape carried by the attachment manifest. */
export interface AttachmentManifestEntry {
  ref: string
  at: number | null
}

/** A lazy lookup the renderer supplies: undefined = still loading, null = resolved missing. */
export type AttachmentGetter = (ref: string) => AttachmentLike | null | undefined

/**
 * F4 (review): lazy variants of the two binders above. Evidence-first,
 * nearest-fallback semantics are preserved, but unresolved images are
 * skipped instead of blocking — they pop in when their data arrives.
 */
function nearestFromManifest(entryAt: number, manifest: ReadonlyArray<AttachmentManifestEntry>): string | null {
  let best: { ref: string; delta: number } | null = null
  for (const entry of manifest) {
    if (entry.at == null) continue
    const delta = Math.abs(entry.at - entryAt)
    const limit = best?.delta ?? NEAREST_SECONDS + 1
    if (delta < limit) best = { ref: entry.ref, delta }
  }
  return best?.ref ?? null
}

export function bindTimelineImagesLazy(
  entry: { at: number; evidence: EvidenceRef[] },
  get: AttachmentGetter,
  manifest: ReadonlyArray<AttachmentManifestEntry>
): TimelineImage[] {
  const bound: TimelineImage[] = []
  const seen = new Set<string>()
  for (const evidence of entry.evidence) {
    const hit = get(evidence.ref)
    if (hit == null || seen.has(hit.ref)) continue
    seen.add(hit.ref)
    bound.push({ ref: hit.ref, dataUrl: hit.dataUrl, origin: 'evidence' })
  }
  if (bound.length === 0) {
    const nearestRef = nearestFromManifest(entry.at, manifest)
    const nearest = nearestRef != null ? get(nearestRef) : null
    if (nearest != null) bound.push({ ref: nearest.ref, dataUrl: nearest.dataUrl, origin: 'nearest' })
  }
  return bound
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
