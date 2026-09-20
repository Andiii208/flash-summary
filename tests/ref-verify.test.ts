/**
 * 批1 (plan 2026-09-17 note-quality-upgrade) 单测：转写锚核验。
 *
 * 这是本批的核心价值——时间锚进了素材层，模型输出的 `at` 与摘引第一次能被
 * 机械核验。此前无从核验，只能编（实测失败形态是散文 ref，见 schema.ts:168
 * 的 field case 注释）。
 */
import { describe, expect, it } from 'vitest'
import { parseNote } from '../src/shared/notes/schema'
import {
  clampNoteTimes,
  REF_NEIGHBORHOOD_SECONDS,
  normalizeForMatch,
  quoteMatchesTranscript,
  transcriptRefHitRate,
  verifyTranscriptRefs,
  verifyNoteRefs,
  type RefVerifyStats
} from '../src/shared/notes/ref-verify'
import { cleanSegments, formatTimedTranscript } from '../src/shared/notes/transcript-clean'

const SEGMENTS = cleanSegments([
  { at: 0, text: '我们这节课讲梯度下降的收敛条件' },
  { at: 120, text: '学习率过大时损失会震荡甚至发散' },
  { at: 240, text: '批量大小取 32 时训练最稳定' }
])

describe('normalizeForMatch 归一化', () => {
  it('剥掉空白与中英标点，只留可比对内容', () => {
    expect(normalizeForMatch('学习率，过大 时（损失）会震荡！')).toBe('学习率过大时损失会震荡')
    expect(normalizeForMatch('a, b; c')).toBe('abc')
  })
})

describe('quoteMatchesTranscript 摘引匹配', () => {
  it('子串命中：模型直接摘引', () => {
    expect(quoteMatchesTranscript('学习率过大时损失会震荡甚至发散', SEGMENTS)).toBe(true)
  })

  it('子串命中：摘引时去掉语气词/标点仍算命中', () => {
    expect(quoteMatchesTranscript('学习率过大时，损失会震荡', SEGMENTS)).toBe(true)
  })

  it('跨分片边界的滑窗也能命中', () => {
    const joined = '我们这节课讲梯度下降的收敛条件学习率过大时损失会震荡甚至发散'
    expect(quoteMatchesTranscript('收敛条件学习率过大时损失', SEGMENTS)).toBe(true)
    expect(joined.length).toBeGreaterThan(20)
  })

  it('编造的摘引不命中', () => {
    expect(quoteMatchesTranscript('讲者说了一句转写里完全没有的漂亮话', SEGMENTS)).toBe(false)
  })

  it('过短的摘引不做包含判断（太短无从区分）', () => {
    expect(quoteMatchesTranscript('学习率', SEGMENTS)).toBe(false)
  })

  it('空分片集合不命中（判不了就是判不了）', () => {
    expect(quoteMatchesTranscript('任意一段足够长的摘引内容', [])).toBe(false)
  })
})

describe('verifyNoteRefs 整篇核验', () => {
  const build = (over: Record<string, unknown> = {}): ReturnType<typeof parseNote> =>
    parseNote(
      JSON.stringify({
        overview: '#'.repeat(0) + '概览内容'.repeat(60) + '\n\n## 本讲主线\n- 一点',
        knowledgeTree: { title: '梯度下降', children: [] },
        timeline: [],
        concepts: [],
        formulasAndSteps: [],
        methodology: '方法论述内容',
        examCues: [],
        questionsAndGaps: [],
        quiz: [],
        conceptLinks: [],
        transcriptRefs: [],
        evidence: [],
        ...over
      })
    )

  it('合法摘引 + 合理时间 → 全部保留，命中率 1/1', () => {
    const note = build({
      timeline: [
        {
          at: 120,
          title: '学习率过大',
          detail: '学习率过大时损失震荡，演示中从 0.1 调到 1.0 后直接发散，验证了理论预期。',
          refs: [{ at: 120, text: '学习率过大时损失会震荡甚至发散' }],
          evidence: []
        }
      ]
    })
    const { note: out, stats } = verifyNoteRefs(note, SEGMENTS)
    expect(out.timeline[0]?.refs).toHaveLength(1)
    expect(out.timeline[0]?.refs[0]?.text).toBe('学习率过大时损失会震荡甚至发散')
    expect(stats.droppedAt).toBe(0)
    expect(stats.clearedText).toBe(0)
    expect(transcriptRefHitRate(stats)).toEqual({ hits: 1, total: 1 })
  })

  it('at 越界 → 整条丢弃（定位是假的）', () => {
    const note = build({
      timeline: [
        {
          at: 120,
          title: '学习率过大',
          detail: '学习率过大时损失震荡，演示中从 0.1 调到 1.0 后直接发散，验证了理论预期。',
          refs: [{ at: 99999, text: '学习率过大时损失会震荡甚至发散' }],
          evidence: []
        }
      ]
    })
    const { note: out, stats } = verifyNoteRefs(note, SEGMENTS)
    expect(out.timeline[0]?.refs).toHaveLength(0)
    expect(stats.droppedAt).toBe(1)
  })

  it('摘引匹配不上 → 清空 text 但保留 at（降级而非报错）', () => {
    const note = build({
      timeline: [
        {
          at: 120,
          title: '学习率过大',
          detail: '学习率过大时损失震荡，演示中从 0.1 调到 1.0 后直接发散，验证了理论预期。',
          refs: [{ at: 120, text: '这句漂亮话转写里根本没有出现过啊' }],
          evidence: []
        }
      ]
    })
    const { note: out, stats } = verifyNoteRefs(note, SEGMENTS)
    expect(out.timeline[0]?.refs[0]).toEqual({ at: 120, text: '' })
    expect(stats.clearedText).toBe(1)
    // 被清空的摘引**仍留在分母里**：若把它排除，一份全篇编造摘引的笔记会显示
    // 「无可判数据」而不是 0%，恰好掩盖了这个指标要暴露的问题。只有模型压根
    // 没写摘引（quoted === 0）才算「无可判」，返回 null。
    expect(transcriptRefHitRate(stats)).toEqual({ hits: 0, total: 1 })
  })

  it('refs.at 离条目 at 过远 → 只记数，不改数据（诊断口径）', () => {
    const note = build({
      timeline: [
        {
          at: 240,
          title: '批量大小',
          detail: '批量取 32 时训练最稳定，显存占用与收敛速度的折中最优。'.repeat(2),
          refs: [{ at: 0, text: '我们这节课讲梯度下降的收敛条件' }],
          evidence: []
        }
      ]
    })
    const { note: out, stats } = verifyNoteRefs(note, SEGMENTS)
    expect(stats.offNeighborhood).toBe(1)
    expect(out.timeline[0]?.refs).toHaveLength(1)
    expect(REF_NEIGHBORHOOD_SECONDS).toBe(120)
  })

  it('概念的 refs 无父时间，只做范围与摘引核验', () => {
    const note = build({
      concepts: [
        {
          term: '梯度下降',
          definition: '一种沿负梯度方向迭代更新参数的一阶优化方法，代价是学习率敏感且易停在局部极小。',
          refs: [{ at: 0, text: '我们这节课讲梯度下降的收敛条件' }]
        }
      ]
    })
    const { note: out, stats } = verifyNoteRefs(note, SEGMENTS)
    expect(out.concepts[0]?.refs).toHaveLength(1)
    expect(stats.offNeighborhood).toBe(0)
    expect(stats.quotedVerified).toBe(1)
  })

  it('无时间锚的旧素材：判不了 at 就不做 at 核验（向后兼容）', () => {
    const timeless = cleanSegments([{ text: '这是一段没有时间戳的旧转写内容，长度足够。' }])
    const note = build({
      timeline: [
        {
          at: 999999,
          title: '旧数据',
          detail: '这一段没有任何时间参考，越界的 at 在旧素材上不应该被当作造假丢弃。'.repeat(2),
          refs: [{ at: 999999, text: '这是一段没有时间戳的旧转写内容' }]
        }
      ]
    })
    const { note: out, stats } = verifyNoteRefs(note, timeless)
    expect(stats.droppedAt).toBe(0)
    expect(out.timeline[0]?.refs).toHaveLength(1)
  })

  it('不改入参（纯函数）', () => {
    const note = build({
      timeline: [
        {
          at: 120,
          title: '学习率过大',
          detail: '学习率过大时损失震荡，演示中从 0.1 调到 1.0 后直接发散，验证了理论预期。',
          refs: [{ at: 120, text: '不存在的摘引内容啊啊啊' }],
          evidence: []
        }
      ]
    })
    verifyNoteRefs(note, SEGMENTS)
    expect(note.timeline[0]?.refs[0]?.text).toBe('不存在的摘引内容啊啊啊')
  })

  it('无可判摘引时命中率为 null（调用方隐藏徽标而非除零）', () => {
    const empty: RefVerifyStats = { total: 0, droppedAt: 0, clearedText: 0, quoted: 0, quotedVerified: 0, offNeighborhood: 0 }
    expect(transcriptRefHitRate(empty)).toBeNull()
  })
})

describe('带时间锚的转写拼接（批1 素材层）', () => {
  it('SEU 的 120s 分片各占一格、时间不变', () => {
    const text = formatTimedTranscript(SEGMENTS)
    expect(text.split('\n')).toHaveLength(3)
    expect(text).toContain('[00:00] 我们这节课讲梯度下降的收敛条件')
    expect(text).toContain('[02:00] 学习率过大时损失会震荡甚至发散')
    expect(text).toContain('[04:00] 批量大小取 32 时训练最稳定')
  })

  it('B站细粒度字幕按 30s 窗合流，避免逐句打时间戳把 token 撑爆', () => {
    const dense = Array.from({ length: 900 }, (_, i) => ({ at: i * 2, text: `第${i}句字幕内容` }))
    const text = formatTimedTranscript(cleanSegments(dense))
    const lines = text.split('\n')
    // 1800 秒 / 30s 窗 = 60 行，而不是 900 行。
    expect(lines).toHaveLength(60)
    expect(text).toContain('[00:00] 第0句字幕内容 第1句字幕内容')
  })

  it('缺 at 的段退化为纯文本行，不报错也不丢内容', () => {
    const text = formatTimedTranscript(cleanSegments([{ at: 0, text: '有时间的一段内容' }, { text: '没有时间的一段内容' }]))
    expect(text.split('\n')).toEqual(['[00:00] 有时间的一段内容', '没有时间的一段内容'])
  })

  it('近空段仍被剔除（清洗纪律不变）', () => {
    const text = formatTimedTranscript(cleanSegments([{ at: 0, text: '嗯。' }, { at: 0, text: '真正的一段有效内容' }]))
    expect(text).toBe('[00:00] 真正的一段有效内容')
  })
})

describe('clampNoteTimes（B4, plan 2026-09-19-note-experience-overhaul）', () => {
  const noteWith = (ats: number[]): ReturnType<typeof parseNote> =>
    parseNote(
      JSON.stringify({
        overview: 'o',
        knowledgeTree: { title: 'r', children: [] },
        methodology: 'm',
        timeline: ats.map((at) => ({ at, title: 't', detail: 'd', refs: [], evidence: [] })),
        transcriptRefs: ats.map((at) => ({ at, text: '摘引' }))
      })
    )

  it('真实案例：73.8 分钟视频的 5 条越界 at 全部钳到转写范围上界', () => {
    // 2026-09-19 真实库实测形态：转写覆盖 0–4425s（+30s 窗 → 4455），
    // 而模型把 5 条时间线写到了 5002–7201 秒（超出视频本体最多 62 分钟）。
    const segments = cleanSegments([
      { at: 0, text: '我们先介绍这门课的学习目标和安排' },
      { at: 2400, text: '这里讲数组的定义和内存布局' },
      { at: 4425, text: '最后回到指针的总结和下课预告' }
    ])
    const note = noteWith([0, 2330, 5002, 5401, 5930, 6830, 7201])
    const { note: clamped, clamped: count } = clampNoteTimes(note, segments)
    // 5 条越界时间线 + 同样越界的 5 条 transcriptRefs = 10 个时间字段被钳。
    // （生产路径上 verifyNoteRefs 先丢越界 refs，这里的 transcriptRefs 钳制是二道防线。）
    expect(count).toBe(10)
    expect(clamped.timeline.map((t) => t.at)).toEqual([0, 2330, 4455, 4455, 4455, 4455, 4455])
    expect(clamped.transcriptRefs.every((r) => r.at <= 4455)).toBe(true)
  })

  it('范围内的 at 原样保留（逐字节不变），计数为 0', () => {
    const note = noteWith([0, 120, 240])
    const result = clampNoteTimes(note, SEGMENTS)
    expect(result.clamped).toBe(0)
    expect(result.note).toEqual(note)
  })

  it('无转写（range 为 null）时原样返回，不钳不猜', () => {
    const note = noteWith([9999])
    const result = clampNoteTimes(note, [])
    expect(result.clamped).toBe(0)
    expect(result.note).toBe(note)
  })

  it('钳制是幂等的：对已钳过的笔记再钳一次计数为 0', () => {
    const note = noteWith([9999])
    const once = clampNoteTimes(note, SEGMENTS)
    const twice = clampNoteTimes(once.note, SEGMENTS)
    expect(twice.clamped).toBe(0)
    expect(twice.note).toEqual(once.note)
  })
})

describe('verifyTranscriptRefs（B2 金句核验复用, plan 2026-09-19）', () => {
  it('越界金句被钳制前先按范围丢弃，匹配不上的清空 text 保 at', () => {
    const { refs, stats } = verifyTranscriptRefs(
      [
        { at: 119, text: '学习率过大时损失会震荡' },
        { at: 99999, text: '这句根本不存在啊啊啊啊' },
        { at: 121, text: '完全是另一段话的内容啊啊' }
      ],
      SEGMENTS
    )
    expect(stats.droppedAt).toBe(1)
    expect(stats.quotedVerified).toBe(1)
    expect(refs[0]?.text).toBe('学习率过大时损失会震荡')
    // 越界那条已整条丢弃，剩下两条；索引前移。
    expect(refs).toHaveLength(2)
    expect(refs[1]).toEqual({ at: 121, text: '' })
  })

  it('空数组 → 全 0（无金句是合法态）', () => {
    const { refs, stats } = verifyTranscriptRefs([], SEGMENTS)
    expect(refs).toEqual([])
    expect(stats).toEqual({ total: 0, droppedAt: 0, clearedText: 0, quoted: 0, quotedVerified: 0 })
  })
})
