import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { exportCourseToObsidian } from '../src/main/notes/obsidian-export'

/**
 * 批3 (plan 2026-09-20, P23/D9): 整课导出的失败必须带原因回来。
 *
 * 此前 `exportCourseToObsidian` 的 catch 是空的——vault 落在 OneDrive 同步目录 /
 * 只读位置 / 路径根本不是目录时，N 篇全部只体现为 `skipped +1`，界面说「N 个课时
 * 无笔记已跳过」，用户以为那些课时只是没有笔记，日志里也没有一个字。
 *
 * 这里盯三件事：
 *   · 写失败逐篇进 failures，带 lessonId 与可读原因（截断到 200 字符）；
 *   · 「该课时还没笔记」是**合法状态**——只算 skipped，不进 failures（否则界面会把
 *     一门还没生成过笔记的课报成故障）；
 *   · 成功的篇目与索引重建不受影响（exported > 0 仍重建 _概念/_index）。
 */

const NOTE = JSON.stringify({
  overview: 'o',
  knowledgeTree: { title: 'r', children: [] },
  methodology: 'm',
  concepts: [{ term: '傅里叶级数', definition: '第一讲的定义。' }],
  examCues: [],
  questionsAndGaps: []
})

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-obsidian-fail-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-20T00:00:00Z')").run()
})

afterEach(() => {
  db?.close()
  rmSync(dir, { recursive: true, force: true })
})

function seedLesson(lessonId: string, noteJson: string | null): void {
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES (?, 'c1', ?, '2026-09-20T00:00:00Z')").run(
    lessonId,
    `课时 ${lessonId}`
  )
  if (noteJson != null) {
    db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES (?, ?, 1, ?, 'p', 'm', '2026-09-20T00:00:00Z')"
    ).run(`n-${lessonId}`, lessonId, noteJson)
  }
}

/** vault 路径指向一个**普通文件**——任何写入都必然失败（等价于「不可写的仓库」）。 */
function fileAsVault(): string {
  const path = join(dir, 'vault-is-a-file')
  writeFileSync(path, 'not a directory')
  return path
}

describe('exportCourseToObsidian 失败可见（批3, P23）', () => {
  it('vault 不可写：每篇失败都带 lessonId + 原因，exported=0 且不重建索引', () => {
    seedLesson('l1', NOTE)
    seedLesson('l2', NOTE)
    const result = exportCourseToObsidian(db, dir, 'c1', fileAsVault())
    expect(result.exported).toBe(0)
    expect(result.skipped).toBe(2)
    expect(result.failures.map((f) => f.lessonId).sort()).toEqual(['l1', 'l2'])
    for (const failure of result.failures) {
      expect(failure.reason.length).toBeGreaterThan(0)
      expect(failure.reason.length).toBeLessThanOrEqual(200)
    }
    // exported=0 → 索引不重建（现状保留）。
    expect(existsSync(join(fileAsVault(), 'Flash Summary', '_index.md'))).toBe(false)
  })

  it('原因截断到 200 字符（toast 与日志行都要放得下）', () => {
    seedLesson('l1', NOTE)
    const longName = 'x'.repeat(400)
    const result = exportCourseToObsidian(db, dir, 'c1', join(dir, longName, longName))
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.reason.length).toBeLessThanOrEqual(200)
  })

  it('「无笔记」是合法状态：只算 skipped，不进 failures', () => {
    seedLesson('l1', NOTE)
    seedLesson('l2', null)
    const vault = join(dir, 'vault')
    const result = exportCourseToObsidian(db, dir, 'c1', vault)
    expect(result).toEqual({ exported: 1, skipped: 1, failures: [] })
    // 成功的篇目照常落盘、索引照常重建。
    expect(existsSync(join(vault, 'Flash Summary', '课程', '课时 l1.md'))).toBe(true)
    expect(existsSync(join(vault, 'Flash Summary', '_index.md'))).toBe(true)
  })

  it('单篇失败不中断整课：其余篇目照常导出并重建索引', () => {
    seedLesson('l1', NOTE)
    seedLesson('l2', NOTE)
    const vault = join(dir, 'vault')
    // 目标文件位置被一个**目录**占着 → 这一篇 writeFileSync 必失败（EISDIR），
    // 另一篇与随后的索引重建不受影响。
    mkdirSync(join(vault, 'Flash Summary', '课程', '课时 l2.md'), { recursive: true })
    const result = exportCourseToObsidian(db, dir, 'c1', vault)
    expect(result.exported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.lessonId).toBe('l2')
    expect(result.failures[0]?.reason.length).toBeGreaterThan(0)
    expect(existsSync(join(vault, 'Flash Summary', '课程', '课时 l1.md'))).toBe(true)
    expect(existsSync(join(vault, 'Flash Summary', '_index.md'))).toBe(true)
  })
})
