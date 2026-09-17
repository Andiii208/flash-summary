/**
 * 批1b (plan 2026-09-17 note-quality-upgrade) 单测：PPT × 关键帧视觉融合。
 *
 * 融合是纯函数（只吃哈希），所以这里能用合成哈希把每条规则钉死——不需要真实
 * PPT/关键帧素材。真实数据的端到端验证另见方案 §批1 的验收项（含人工抽样对照）。
 *
 * 事实前提（代码已核实）：关键帧抽自 `screen/PPT stream` 且**带时间**；平台 PPT 是
 * **courseId 级**端点、随每个 lesson 各存一份且**没有时间**。两者拍同一块屏幕。
 */
import { describe, expect, it } from 'vitest'
import { CROSS_SOURCE_DUPLICATE_DISTANCE, fuseVisualEvidence, type VisualCandidate } from '../src/shared/notes/visual-fusion'

/** 64 位哈希：按种子生成确定性的位串。 */
function hashOf(seed: string): string {
  let bits = ''
  let value = 7
  for (let i = 0; i < seed.length + 64; i++) {
    const code = i < seed.length ? seed.charCodeAt(i) : 0
    value = (value * 31 + code + i) % 2147483647
    bits += value % 2 === 0 ? '0' : '1'
    if (bits.length === 64) break
  }
  return bits.padEnd(64, '0')
}

/** 在 base 上翻转 count 位，得到一个汉明距离恰好为 count 的哈希。 */
function hashNear(base: string, count: number): string {
  const chars = base.split('')
  for (let i = 0; i < count; i++) chars[i] = chars[i] === '0' ? '1' : '0'
  return chars.join('')
}

const ppt = (page: number, hash: string | null = hashOf(`ppt-${page}`)): VisualCandidate => ({
  ref: `ppt:${page}`,
  kind: 'ppt',
  at: null,
  hash
})

const kf = (id: number, at: number, hash: string | null): VisualCandidate => ({
  ref: `kf:${id}`,
  kind: 'keyframe',
  at,
  hash
})

describe('fuseVisualEvidence 融合规则', () => {
  it('撞图：留 PPT 页（更清晰），关键帧计入冗余不再发送，并给 PPT 反推时间', () => {
    const slideHash = hashOf('slide-A')
    const result = fuseVisualEvidence([ppt(0, slideHash), kf(1, 300, hashNear(slideHash, 1)), kf(2, 900, hashOf('黑板书'))], {
      maxImages: 20
    })
    expect(result.matchedKeyframes).toEqual(['kf:1'])
    expect(result.redundantKeyframes).toEqual(['kf:1'])
    // 板书那一帧与任何 PPT 页都不像 → 必须保留（PPT 里没有的信息）
    expect(result.uniqueKeyframes).toEqual(['kf:2'])
    expect(result.selected).toEqual(['ppt:0', 'kf:2'])
    expect(result.inferredTimes.get('ppt:0')).toBe(300)
  })

  it('时间推断取**首次**出现：同一页被多帧拍到只认最早那次', () => {
    const slideHash = hashOf('slide-B')
    const result = fuseVisualEvidence([ppt(3, slideHash), kf(1, 600, hashNear(slideHash, 2)), kf(2, 120, hashNear(slideHash, 1))], {
      maxImages: 20
    })
    expect(result.inferredTimes.get('ppt:3')).toBe(120)
  })

  it('课程级 deck 的正解：没被匹配上的 PPT 页属于别的课时，不发送', () => {
    const used = hashOf('used-slide')
    const result = fuseVisualEvidence(
      [ppt(0, used), ppt(1, hashOf('other-lesson-slide-1')), ppt(2, hashOf('other-lesson-slide-2'))],
      { maxImages: 20 }
    )
    expect(result.matchedKeyframes).toEqual([])
    expect(result.selected).toContain('ppt:0')
    // 零命中触发兜底（匹配无信息）——见下一条；此处用有命中的场景验证筛选。
    const withMatch = fuseVisualEvidence(
      [ppt(0, used), ppt(1, hashOf('other-lesson-slide-1')), ppt(2, hashOf('other-lesson-slide-2')), kf(1, 60, used)],
      { maxImages: 20 }
    )
    expect(withMatch.selected).toEqual(['ppt:0'])
  })

  it('一张都没匹配上 → 退回按页序均匀采样 PPT（不能拿「没匹配」当「没用到」）', () => {
    const pptsOnly = [ppt(0), ppt(1), ppt(2)]
    // 没有关键帧可比对
    expect(fuseVisualEvidence(pptsOnly, { maxImages: 20 }).selected).toEqual(['ppt:0', 'ppt:1', 'ppt:2'])
    // 有关键帧但全都不像任何 PPT 页
    const noMatch = fuseVisualEvidence([...pptsOnly, kf(1, 30, hashOf('板书'))], { maxImages: 20 })
    expect(noMatch.matchedKeyframes).toEqual([])
    expect(noMatch.selected).toEqual(['ppt:0', 'ppt:1', 'ppt:2', 'kf:1'])
  })

  it('解码失败的候选：关键帧照发（少发图是回归），PPT 在有命中的情形下不发', () => {
    const used = hashOf('used')
    const result = fuseVisualEvidence(
      [ppt(0, used), ppt(1, null), kf(1, 100, used), kf(2, 200, null)],
      { maxImages: 20 }
    )
    // ppt:1 解不出 → 无法确认本讲是否用到，而匹配是有信息的 → 不发
    expect(result.selected).toEqual(['ppt:0', 'kf:2'])
  })

  it('超预算：两边均分且有余量互让，长度不超预算，绝不因冗余砍 PPT', () => {
    const slides = Array.from({ length: 30 }, (_, i) => ppt(i, hashOf(`s-${i}`)))
    const uniques = Array.from({ length: 30 }, (_, i) => kf(i, i * 10, hashOf(`board-${i}`)))
    const result = fuseVisualEvidence([...slides, ...uniques], { maxImages: 20 })
    expect(result.selected).toHaveLength(20)
    expect(result.selected.filter((r) => r.startsWith('ppt:')).length).toBe(10)
    expect(result.selected.filter((r) => r.startsWith('kf:')).length).toBe(10)

    // 一边不够时另一边补齐，配额不浪费
    const fewKeyframes = fuseVisualEvidence([...slides, kf(99, 5, hashOf('only-board'))], { maxImages: 20 })
    expect(fewKeyframes.selected).toHaveLength(20)
    expect(fewKeyframes.selected.filter((r) => r.startsWith('ppt:')).length).toBe(19)
  })

  it('预算为 0 时什么都不发（边界）', () => {
    expect(fuseVisualEvidence([ppt(0), kf(1, 10, hashOf('x'))], { maxImages: 0 }).selected).toEqual([])
  })

  it('空输入不炸', () => {
    const empty = fuseVisualEvidence([], { maxImages: 20 })
    expect(empty.selected).toEqual([])
    expect(empty.inferredTimes.size).toBe(0)
  })

  it('跨源阈值比帧内去重更紧：轻微批注过的幻灯片不会被误判为冗余', () => {
    const slideHash = hashOf('annotated')
    // 距离 4：帧内去重（≤5）会判重，跨源（≤3）应当判为不同 → 关键帧保留
    const result = fuseVisualEvidence([ppt(0, slideHash), kf(1, 240, hashNear(slideHash, 4))], { maxImages: 20 })
    expect(result.uniqueKeyframes).toEqual(['kf:1'])
    expect(result.selected).toEqual(['ppt:0', 'kf:1'])
    expect(CROSS_SOURCE_DUPLICATE_DISTANCE).toBe(3)
  })

  it('不改入参、结果确定（纯函数）', () => {
    const candidates = [ppt(0, hashOf('a')), kf(1, 60, hashOf('a')), kf(2, 90, hashOf('b'))]
    const snapshot = JSON.stringify(candidates)
    const first = fuseVisualEvidence(candidates, { maxImages: 20 })
    const second = fuseVisualEvidence(candidates, { maxImages: 20 })
    expect(JSON.stringify(candidates)).toBe(snapshot)
    expect(first.selected).toEqual(second.selected)
    expect([...first.inferredTimes.entries()]).toEqual([...second.inferredTimes.entries()])
  })

  it('发送顺序稳定：PPT 在前（按推断时间序）、关键帧在后（按时间序）', () => {
    const result = fuseVisualEvidence(
      [ppt(5, hashOf('late')), ppt(2, hashOf('early')), kf(1, 600, hashOf('late')), kf(2, 100, hashOf('early')), kf(3, 900, hashOf('board'))],
      { maxImages: 20 }
    )
    expect(result.selected).toEqual(['ppt:2', 'ppt:5', 'kf:3'])
  })
})
