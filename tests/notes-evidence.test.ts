import { describe, expect, it } from 'vitest'
import {
  bindTimelineImages,
  nearestKeyframe,
  resolveEvidenceGallery,
  evidenceHitRate,
  allocateTimelineImages,
  allocateTimelineImagesLazy,
  ALLOCATION_MIN_TOLERANCE_SECONDS,
  ALLOCATION_MAX_TOLERANCE_SECONDS,
  formatTime,
  quoteForEntry,
  type AttachmentLike,
  type AttachmentGetter,
  type AttachmentManifestEntry
} from '../src/shared/notes/evidence'
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
    // Beyond the tolerance floor nothing binds either (single frame → floor 120s).
    const far = bindTimelineImages({ at: 100 + ALLOCATION_MIN_TOLERANCE_SECONDS + 1, evidence: [] }, [kf('kf:a', 100)])
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

describe('evidenceHitRate (roadmap 1.3, 2026-09-04)', () => {
  const noteWith = (refs: string[]): ReturnType<typeof parseNote> =>
    parseNote(
      JSON.stringify({
        overview: 'o',
        knowledgeTree: { title: 'r', children: [] },
        methodology: 'm',
        timeline: refs.map((ref) => ({ at: 10, title: 't', detail: 'd', evidence: [{ kind: 'keyframe', ref }] }))
      })
    )

  it('all cited refs resolve → hits === total', () => {
    const rate = evidenceHitRate(noteWith(['kf:a', 'kf:b']), [kf('kf:a', 0), kf('kf:b', 30)])
    expect(rate).toEqual({ hits: 2, total: 2 })
  })

  it('partly fabricated refs count against the total', () => {
    // kf:fabricated.1 passes the schema ref-format filter but matches no
    // attachment — exactly the real-world miss the metric measures.
    const rate = evidenceHitRate(noteWith(['kf:a', 'kf:fabricated.1']), [kf('kf:a', 0)])
    expect(rate).toEqual({ hits: 1, total: 2 })
  })

  it('no cited ref resolves → zero hits', () => {
    const rate = evidenceHitRate(noteWith(['kf:x', 'kf:y']), [kf('kf:a', 0)])
    expect(rate).toEqual({ hits: 0, total: 2 })
  })

  it('dedupes repeated refs and yields total 0 when nothing cited', () => {
    const repeated = evidenceHitRate(noteWith(['kf:a', 'kf:a']), [kf('kf:a', 0)])
    expect(repeated).toEqual({ hits: 1, total: 1 })
    expect(evidenceHitRate(noteWith([]), [kf('kf:a', 0)])).toEqual({ hits: 0, total: 0 })
  })
})

describe('allocateTimelineImages（批 A5 跨条目贪心一对一，plan 2026-09-19）', () => {
  /** 今天那份真实笔记的形态：74 分钟视频 18 帧（含 935s 空窗），18 条时间线。 */
  const realKeyframes = [
    0, 990, 1250, 1340, 1350, 1400, 1520, 1530, 1550, 1610, 1630, 2020, 2410, 3120, 3160, 3210, 3250, 3490
  ]
  const realEntryAts = [0, 64, 232, 330, 502, 1030, 1432, 2001, 2131, 2501, 2730, 3702, 4130, 5002, 5401, 5930, 6830, 7201]

  it('真实回归：18 帧 18 条按全局贪心配对（先钉当前形态，A4 增密后再谈覆盖率）', () => {
    const attachments = realKeyframes.map((at, i) => kf(`kf:${i}`, at))
    const entries = realEntryAts.map((at) => ({ at, evidence: [] }))
    const allocated = allocateTimelineImages(entries, attachments)
    // 帧距中位数 60s → 容差 120s。当前形态下可配的是 5 条（与旧 90s 筛子同数，
    // 但帧的归属是最优的：稀缺帧给更近的条目，且屏幕端与 PDF 端同口径）。
    // 覆盖率跃升不靠本函数——靠批 A4 的帧库增密（20s/222 帧 + 覆盖保底）。
    const bound = allocated.map((images, i) => (images.length > 0 ? i : -1)).filter((i) => i >= 0)
    expect(bound).toEqual([0, 5, 6, 7, 9])
    expect(allocated[0]?.map((im) => im.ref)).toEqual(['kf:0']) // at=0 → 帧@0
    expect(allocated[5]?.map((im) => im.ref)).toEqual(['kf:1']) // at=1030 → 帧@990
    expect(allocated[6]?.map((im) => im.ref)).toEqual(['kf:5']) // at=1432 → 帧@1400
    expect(allocated[7]?.map((im) => im.ref)).toEqual(['kf:11']) // at=2001 → 帧@2020
    expect(allocated[9]?.map((im) => im.ref)).toEqual(['kf:12']) // at=2501 → 帧@2410
    // 一对一：配上的 5 帧互不相同
    const refs = allocated.flatMap((images) => images.map((im) => im.ref))
    expect(new Set(refs).size).toBe(5)
    expect(allocated.every((images) => images.every((im) => im.origin === 'nearest'))).toBe(true)
  })

  it('稀缺帧给更近的条目：两条争同一帧时，更近者得，另一条拿次近', () => {
    const attachments = [kf('kf:a', 0), kf('kf:b', 500)]
    const entries = [
      { at: 480, evidence: [] }, // 离 kf:b 差 20
      { at: 520, evidence: [] } // 离 kf:b 差 20 → 平手时条目序优先，kf:a 归第二条
    ]
    const allocated = allocateTimelineImages(entries, attachments)
    expect(allocated[0]?.map((im) => im.ref)).toEqual(['kf:b'])
    expect(allocated[1]?.map((im) => im.ref)).toEqual(['kf:a'])
  })

  it('evidence 引用优先且不占分配池：未引用的帧仍可供其他条目就近配对', () => {
    const attachments = [kf('kf:a', 0), kf('kf:b', 300), kf('kf:c', 900)]
    const entries = [
      { at: 0, evidence: [{ kind: 'keyframe' as const, ref: 'kf:c' }] },
      { at: 310, evidence: [] }
    ]
    const allocated = allocateTimelineImages(entries, attachments)
    expect(allocated[0]).toEqual([{ ref: 'kf:c', dataUrl: 'data:image/jpeg;base64,kf:c', origin: 'evidence' }])
    expect(allocated[1]?.map((im) => im.ref)).toEqual(['kf:b'])
    expect(allocated[1]?.[0]?.origin).toBe('nearest')
  })

  it('多个条目引用同一帧：各自显示（引用语义与旧行为一致），该帧退出就近池', () => {
    const attachments = [kf('kf:a', 0), kf('kf:b', 300)]
    const entries = [
      { at: 10, evidence: [{ kind: 'keyframe' as const, ref: 'kf:b' }] },
      { at: 290, evidence: [{ kind: 'keyframe' as const, ref: 'kf:b' }] }
    ]
    const allocated = allocateTimelineImages(entries, attachments)
    expect(allocated.every((images) => images.length === 1 && images[0]?.ref === 'kf:b')).toBe(true)
  })

  it('容差封顶 600s：帧极稀时超过上限的配对不发生（诚实文字卡）', () => {
    // 两帧相距 1500s → 容差被夹到 600s；距唯一帧 700s 的条目配不上。
    const attachments = [kf('kf:a', 0), kf('kf:b', 1500)]
    const entries = [
      { at: 700, evidence: [] },
      { at: 1450, evidence: [] }
    ]
    const allocated = allocateTimelineImages(entries, attachments)
    expect(allocated[0]).toEqual([])
    expect(allocated[1]?.map((im) => im.ref)).toEqual(['kf:b'])
    expect(ALLOCATION_MAX_TOLERANCE_SECONDS).toBe(600)
  })

  it('零帧 → 全部文字卡；引用了不存在 ref 的条目进就近池', () => {
    expect(allocateTimelineImages([{ at: 10, evidence: [] }], [])).toEqual([[]])
    const allocated = allocateTimelineImages(
      [{ at: 90, evidence: [{ kind: 'keyframe' as const, ref: 'kf:fabricated' }] }],
      [kf('kf:a', 100)]
    )
    expect(allocated[0]?.map((im) => im.ref)).toEqual(['kf:a'])
  })

  it('懒加载与已解析两形态判定一致（同一 manifest 得到同一分配）', () => {
    const attachments = realKeyframes.map((at, i) => kf(`kf:${i}`, at))
    const manifest: AttachmentManifestEntry[] = realKeyframes.map((at, i) => ({ ref: `kf:${i}`, at }))
    const get: AttachmentGetter = (ref) => attachments.find((a) => a.ref === ref) ?? null
    const entries = realEntryAts.map((at) => ({ at, evidence: [] }))
    const resolved = allocateTimelineImages(entries, attachments).map((images) => images.map((im) => im.ref))
    const lazy = allocateTimelineImagesLazy(entries, get, manifest).map((images) => images.map((im) => im.ref))
    expect(lazy).toEqual(resolved)
  })

  it('懒加载：未解析（undefined）的帧本轮不参与，解析后重算即改进', () => {
    const manifest: AttachmentManifestEntry[] = [
      { ref: 'kf:a', at: 0 },
      { ref: 'kf:b', at: 100 }
    ]
    const entries = [{ at: 90, evidence: [] }]
    // kf:b 还在加载 → 本轮只有 kf:a 可用（Δ90 ≤ 单帧容差 120），先配上；
    const loading: AttachmentGetter = (ref) => (ref === 'kf:b' ? undefined : kf('kf:a', 0))
    expect(allocateTimelineImagesLazy(entries, loading, manifest)[0]?.map((im) => im.ref)).toEqual(['kf:a'])
    // kf:b 解析完成后 version bump 触发重算 → 更近的 kf:b 接手
    const ready: AttachmentGetter = (ref) => (ref === 'kf:b' ? kf('kf:b', 100) : kf('kf:a', 0))
    expect(allocateTimelineImagesLazy(entries, ready, manifest)[0]?.map((im) => im.ref)).toEqual(['kf:b'])
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
