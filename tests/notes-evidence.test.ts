import { describe, expect, it } from 'vitest'
import { bindTimelineImages, nearestKeyframe, resolveEvidenceGallery, formatTime, quoteForEntry, NEAREST_SECONDS, type AttachmentLike } from '../src/shared/notes/evidence'
import { parseNote } from '../src/shared/notes/schema'

function kf(ref: string, at: number, dataUrl = `data:image/jpeg;base64,${ref}`): AttachmentLike {
  return { ref, kind: 'keyframe', at, dataUrl }
}

function ppt(ref: string): AttachmentLike {
  return { ref, kind: 'ppt', at: null, dataUrl: `data:image/jpeg;base64,${ref}` }
}

describe('bindTimelineImages (三层对齐 2026-09-04)', () => {
  it('layer 1: exact evidence refs bind first, in note order', () => {
    const attachments = [kf('kf:a', 0), kf('kf:b', 300), kf('kf:c', 900)]
    const bound = bindTimelineImages(
      { at: 320, evidence: [{ kind: 'keyframe', ref: 'kf:c' }, { kind: 'keyframe', ref: 'kf:b' }] },
      attachments
    )
    expect(bound.map((b) => b.ref)).toEqual(['kf:c', 'kf:b'])
    expect(bound.every((b) => b.origin === 'evidence')).toBe(true)
  })

  it('layer 2: nearest keyframe within the tolerance fallback when no ref matches', () => {
    const attachments = [kf('kf:a', 0), kf('kf:b', 300), kf('kf:c', 900)]
    const bound = bindTimelineImages({ at: 330, evidence: [{ kind: 'keyframe', ref: '超参数调整演示幻灯片' }] }, attachments)
    expect(bound).toHaveLength(1)
    expect(bound[0]?.ref).toBe('kf:b')
    expect(bound[0]?.origin).toBe('nearest')
  })

  it('layer 3: no attachments → empty (text-only card)', () => {
    expect(bindTimelineImages({ at: 100, evidence: [] }, [])).toEqual([])
    // Beyond tolerance nothing binds either.
    const far = bindTimelineImages({ at: 100 + NEAREST_SECONDS + 1, evidence: [] }, [kf('kf:a', 100)])
    expect(far).toEqual([])
  })

  it('dedupes repeated refs within one entry', () => {
    const bound = bindTimelineImages(
      { at: 0, evidence: [{ kind: 'keyframe', ref: 'kf:a' }, { kind: 'keyframe', ref: 'kf:a' }] },
      [kf('kf:a', 0)]
    )
    expect(bound).toHaveLength(1)
  })
})

describe('nearestKeyframe', () => {
  it('picks the closest by |Δ| and ignores ppt pages', () => {
    const attachments = [ppt('ppt:0'), kf('kf:a', 100), kf('kf:b', 200)]
    expect(nearestKeyframe(180, attachments)?.ref).toBe('kf:b')
    expect(nearestKeyframe(90, attachments)?.ref).toBe('kf:a')
    expect(nearestKeyframe(180, [ppt('ppt:0')])).toBeNull()
  })
})

describe('resolveEvidenceGallery', () => {
  it('cited refs first in note order, then remaining keyframes time-ordered', () => {
    const note = parseNote(
      JSON.stringify({
        overview: 'o',
        knowledgeTree: { title: 'r', children: [] },
        methodology: 'm',
        timeline: [{ at: 300, title: 't', detail: 'd', evidence: [{ kind: 'keyframe', ref: 'kf:z' }] }],
        evidence: [{ kind: 'ppt', ref: 'ppt:0' }]
      })
    )
    const attachments = [kf('kf:a', 0), kf('kf:z', 300), ppt('ppt:0'), kf('kf:b', 900)]
    const gallery = resolveEvidenceGallery(note, attachments)
    expect(gallery.map((g) => g.ref)).toEqual(['kf:z', 'ppt:0', 'kf:a', 'kf:b'])
    expect(gallery.slice(0, 2).every((g) => g.origin === 'evidence')).toBe(true)
  })
})

describe('display helpers', () => {
  it('formatTime pads minutes and seconds', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(754)).toBe('12:34')
  })

  it('quoteForEntry picks the ref closest to the entry timestamp', () => {
    const quote = quoteForEntry({ at: 200, refs: [{ at: 0, text: '远' }, { at: 240, text: '近' }] })
    expect(quote?.text).toBe('近')
    expect(quoteForEntry({ at: 200, refs: [] })).toBeNull()
  })
})
