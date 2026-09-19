/**
 * 批3 (plan 2026-09-19 audit-remediation): 视觉哈希的缩略图通道。
 *
 * 覆盖三件事：
 *   ① buildVisualCandidates 有缩略图时解缩略图（解码路径走 thumbPathFor）；
 *   ② loadSummarizeInputs 装配完成后删除该 lesson 两个目录的 thumb-*
 *      （best-effort：删不干净/目录缺失都不抛，原图绝不能被误删）；
 *   ③ 缩略图全缺时回落原图（既有 hash=null 降级路径不动）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { migrate } from '../src/main/db/migrate'
import { buildVisualCandidates } from '../src/main/notes/visual-hash'
import { loadSummarizeInputs } from '../src/main/notes/summarize'
import { storedAttachmentsPath } from '../src/main/library/paths'
import { thumbPathFor } from '../src/main/media/grid'
import { decodeGrid8x8 } from '../src/main/media/grid'
import { averageHash, hammingDistance } from '../src/shared/phash'

const LESSON = 'l-thumb'

function writeSplitPng(path: string, size = 64): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PNG } = require('pngjs') as { PNG: { sync: { write: (d: { data: Uint8Array; width: number; height: number }) => Buffer } } }
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const v = x < size / 2 ? 0 : 255
      data[idx] = v
      data[idx + 1] = v
      data[idx + 2] = v
      data[idx + 3] = 255
    }
  }
  writeFileSync(path, PNG.sync.write({ data, width: size, height: size }))
}

let dir: string
let db: Db

function seedRows(): void {
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c-thumb', '课', '2026-09-19T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES (?, 'c-thumb', '时', '2026-09-19T00:00:00Z')").run(LESSON)
  db.prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES (?, ?, 'openai-compatible', 'm', '2026-09-19T00:00:00Z')").run(
    LESSON,
    JSON.stringify([{ at: 0, text: '片段' }])
  )
  for (const sub of ['keyframes', 'ppt'] as const) {
    const file = sub === 'keyframes' ? 'kf-0000-0s.jpg' : 'page-000.png'
    mkdirSync(join(dir, 'attachments', LESSON, sub), { recursive: true })
    const full = join(dir, 'attachments', LESSON, sub, file)
    writeSplitPng(full) // 关键帧行也用 PNG 内容——解码器按魔数分派，哈希同空间
    if (sub === 'keyframes') {
      db.prepare('INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES (?, ?, 0, ?, ?, ?)')
        .run(`${LESSON}-kf-0`, LESSON, storedAttachmentsPath(LESSON, 'keyframes', file), '0'.repeat(64), '2026-09-19T00:00:00Z')
    } else {
      db.prepare('INSERT INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`${LESSON}-ppt-0`, LESSON, 0, storedAttachmentsPath(LESSON, 'ppt', file), '2026-09-19T00:00:00Z')
    }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-visual-hash-'))
  db = openDatabase(join(dir, 'app.db'))
  migrate(db)
  seedRows()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('批3: buildVisualCandidates 缩略图通道', () => {
  it('有缩略图时解缩略图（hash = 缩略图 grid 的平均哈希）', () => {
    const kfDir = join(dir, 'attachments', LESSON, 'keyframes')
    const pptDir = join(dir, 'attachments', LESSON, 'ppt')
    writeSplitPng(thumbPathFor(join(kfDir, 'kf-0000-0s.jpg')), 32)
    writeSplitPng(thumbPathFor(join(pptDir, 'page-000.png')), 32)

    const cands = buildVisualCandidates(
      [{ page_index: 0, file_path: storedAttachmentsPath(LESSON, 'ppt', 'page-000.png') }],
      [{ id: `${LESSON}-kf-0`, file_path: storedAttachmentsPath(LESSON, 'keyframes', 'kf-0000-0s.jpg'), timestamp_seconds: 0 }],
      dir
    )
    const kfCand = cands.find((c) => c.kind === 'keyframe')!
    const thumbHash = averageHash(decodeGrid8x8(thumbPathFor(join(kfDir, 'kf-0000-0s.jpg'))))
    expect(kfCand.hash).toBe(thumbHash)
    // 缩略图哈希与原图哈希仍在保真门内（≤2/64）
    const fullHash = averageHash(decodeGrid8x8(join(kfDir, 'kf-0000-0s.jpg')))
    expect(hammingDistance(kfCand.hash!, fullHash)).toBeLessThanOrEqual(2)
  })

  it('缩略图缺失时回落原图（降级路径不变）', () => {
    const cands = buildVisualCandidates([], [{ id: `${LESSON}-kf-0`, file_path: storedAttachmentsPath(LESSON, 'keyframes', 'kf-0000-0s.jpg'), timestamp_seconds: 0 }], dir)
    const kfCand = cands[0]!
    expect(kfCand.hash).toBe(averageHash(decodeGrid8x8(join(dir, 'attachments', LESSON, 'keyframes', 'kf-0000-0s.jpg'))))
  })
})

describe('批3: loadSummarizeInputs 装配后清理缩略图', () => {
  it('装配成功且 thumb-* 被删、原图保留；二次调用（无缩略图）照常回落', () => {
    const kfDir = join(dir, 'attachments', LESSON, 'keyframes')
    const pptDir = join(dir, 'attachments', LESSON, 'ppt')
    writeSplitPng(thumbPathFor(join(kfDir, 'kf-0000-0s.jpg')), 32)
    writeSplitPng(thumbPathFor(join(pptDir, 'page-000.png')), 32)

    const inputs = loadSummarizeInputs(db, LESSON, dir)
    expect('error' in inputs).toBe(false)
    if ('error' in inputs) return
    // 关键帧与 PPT 页是同一张分割图 → 融合层按「撞图留 PPT」只发 ppt:0
    // （既有融合规则，不是本批行为）；本批要证的是装配完成 + 缩略图清理。
    expect(inputs.images.map((i) => i.ref).sort()).toEqual(['ppt:0'])

    expect(readdirSync(kfDir)).toEqual(['kf-0000-0s.jpg'])
    expect(readdirSync(pptDir)).toEqual(['page-000.png'])

    // 缩略图已删干净：再跑一次走回落路径，结果不变且不抛。
    const again = loadSummarizeInputs(db, LESSON, dir)
    expect('error' in again).toBe(false)
    if (!('error' in again)) {
      expect(again.images.map((i) => i.ref).sort()).toEqual(['ppt:0'])
    }
  })

  it('目录里混入无关文件时不动它们；附件目录都不存在时也不抛', () => {
    const kfDir = join(dir, 'attachments', LESSON, 'keyframes')
    writeFileSync(join(kfDir, 'notes.txt'), 'keep me')
    rmSync(join(dir, 'attachments', LESSON, 'ppt'), { recursive: true, force: true })

    const inputs = loadSummarizeInputs(db, LESSON, dir)
    expect('error' in inputs).toBe(false)
    expect(existsSync(join(kfDir, 'notes.txt'))).toBe(true)
    expect(existsSync(join(kfDir, 'kf-0000-0s.jpg'))).toBe(true)
  })
})
