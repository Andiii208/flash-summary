/**
 * 批3 保真门（plan 2026-09-19 audit-remediation batch 3）：
 * pHash 的 8x8 网格本来就是「块均值 → 再对 8x8 求平均哈希」的二次近似，
 * 所以哈希改吃小缩略图理论上零质量损失。这里用**真实 ffmpeg** 产出
 * 真实屏幕尺寸样本（1280x720 JPEG q2 = 关键帧同参数），按生产同款
 * 缩滤（宽 64px、高取 8 的倍数，见下）生成缩略图，实测证明：
 *   ① 原图 grid 与缩略图 grid 的平均哈希汉明距离 ≤ 2/64；
 *   ② 同一画面的重复帧仍判重（isDuplicate=true）；
 *   ③ 不同画面仍判轻（hamming > isDuplicate 默认阈值 5）。
 * 断言值来自 brief，不许为将就而降。
 *
 * 缩滤参数来历（brief 许可的调整路径）：`scale=64:-2`（64x36）下单元格
 * 高 4.5px，与全分辨率 720px/8=90px 的格边界错位，硬边样本（白底黑字块
 * 的 textlike）实测 4/64 超门；换成「高显式取 8 的倍数」（64x32）后
 * 8x8 格边界与全分辨率严格对齐，全场 ≤1/64。缩略图只喂哈希、不展示，
 * 这点垂直压缩不影响呈现。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ffmpegPath } from '../src/main/media/binaries'
import { decodeGrid8x8, thumbPathFor, THUMB_SCALE_FILTER } from '../src/main/media/grid'
import { averageHash, hammingDistance, isDuplicate } from '../src/shared/phash'

interface Scene {
  name: string
  full: string
  thumb: string
}

let dir: string
const scenes: Scene[] = []

/**
 * 五类真实屏幕内容：testsrc/testsrc2（渐变+锐边混合）、smptebars（硬边
 * 色条=最坏情形）、rgbtestsrc（纯色块）、drawbox 白底黑字块（近似 PPT
 * 文字=最常见内容）。
 */
const SOURCES: Array<{ name: string; filter: string }> = [
  { name: 'testsrc', filter: 'testsrc=duration=1:size=1280x720:rate=1' },
  { name: 'testsrc2', filter: 'testsrc2=duration=1:size=1280x720:rate=1' },
  { name: 'smptebars', filter: 'smptebars=duration=1:size=1280x720:rate=1' },
  { name: 'rgbtestsrc', filter: 'rgbtestsrc=duration=1:size=1280x720:rate=1' },
  {
    name: 'textlike',
    filter:
      "color=c=white:size=1280x720:rate=1,drawbox=x=100:y=80:w=400:h=24:color=black@1:t=fill," +
      "drawbox=x=100:y=140:w=600:h=16:color=black@1:t=fill," +
      "drawbox=x=100:y=190:w=500:h=20:color=black@1:t=fill,drawbox=x=100:y=260:w=700:h=16:color=black@1:t=fill"
  }
]

/** 生产同款参数：全分辨率帧 JPEG q2，缩略图宽 64px、高取 8 的倍数（格边界对齐）、JPEG q4。 */
function renderFullFrame(name: string, filter: string): string {
  const out = join(dir, `${name}.jpg`)
  execFileSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', filter, '-frames:v', '1', '-q:v', '2', out], { stdio: 'pipe' })
  expect(existsSync(out)).toBe(true)
  return out
}

function renderThumb(full: string): string {
  const thumb = thumbPathFor(full)
  execFileSync(ffmpegPath(), ['-y', '-i', full, '-vf', THUMB_SCALE_FILTER, '-q:v', '4', thumb], { stdio: 'pipe' })
  return thumb
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-thumb-fidelity-'))
  for (const { name, filter } of SOURCES) {
    const full = renderFullFrame(name, filter)
    scenes.push({ name, full, thumb: renderThumb(full) })
  }
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('批3 保真门：thumb-grid 与 full-grid 的平均哈希（真实 ffmpeg）', () => {
  it('帧命名约定 thumbPathFor 单一事实源（同目录 thumb- 前缀）', () => {
    for (const s of scenes) {
      expect(s.thumb).toBe(join(dir, `thumb-${s.name}.jpg`))
    }
  })

  it('缩滤参数单一事实源：宽 64px、高取 8 的倍数（保真门推导定稿，三处共用）', () => {
    expect(THUMB_SCALE_FILTER).toBe('scale=w=64:h=max(8\\,trunc(64*ih/iw/8)*8)')
  })

  it('每张样本图的汉明距离 ≤ 2/64（实测数字打印在测试输出里）', () => {
    for (const s of scenes) {
      const fullHash = averageHash(decodeGrid8x8(s.full))
      const thumbHash = averageHash(decodeGrid8x8(s.thumb))
      const d = hammingDistance(fullHash, thumbHash)
      console.log(`  ${s.name}: hamming(full, thumb) = ${d}/64`)
      expect(d).toBeLessThanOrEqual(2)
    }
  })

  it('重复帧仍判重：同一画面的缩略图哈希互相 isDuplicate', () => {
    const s = scenes[0]!
    const againThumb = join(dir, 'thumb-again.jpg')
    execFileSync(ffmpegPath(), ['-y', '-i', s.full, '-vf', THUMB_SCALE_FILTER, '-q:v', '4', againThumb], { stdio: 'pipe' })
    const h1 = averageHash(decodeGrid8x8(s.thumb))
    const h2 = averageHash(decodeGrid8x8(againThumb))
    expect(hammingDistance(h1, h2)).toBe(0)
    expect(isDuplicate(h1, h2)).toBe(true)
  })

  it('不同帧仍判轻：跨样本 hamming > isDuplicate 阈值（阈值 5）', () => {
    const hashes = scenes.map((s) => averageHash(decodeGrid8x8(s.thumb)))
    let compared = 0
    for (let i = 0; i < hashes.length; i++) {
      for (let j = i + 1; j < hashes.length; j++) {
        const d = hammingDistance(hashes[i]!, hashes[j]!)
        console.log(`  ${scenes[i]!.name} vs ${scenes[j]!.name}: hamming = ${d}/64`)
        expect(isDuplicate(hashes[i]!, hashes[j]!)).toBe(false)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(0)
  })
})
