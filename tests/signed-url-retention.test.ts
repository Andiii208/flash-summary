import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { pruneStaleSignedUrlHandoffs } from '../src/main/tasks/cache-clean'
import { BILI_STREAM_FRESH_MS, STREAM_URL_FRESH_MS } from '../src/main/tasks/resume'

/**
 * 声明批7（plan 2026-09-11 compliance-disclosure）: 签名直链交接的保留期。
 *
 * `task_stage_outputs` 的 fetching_course 行是 app.db 里**唯一明文落盘的敏感 URL**
 * （带 auth_key 的限时签名直链）。三条出路：成功清除、取消清除（批7 新增）、
 * 失败**故意保留**让续跑免于重新收割。这批收口的就是最后那条——「故意保留」不等于
 * 「永久保留」：过了签名的新鲜窗口，续跑本来就会重新收割，那条 URL 只剩风险。
 */

function makeDb(): { db: Db; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'seu-summary-prune-'))
  const db = openDatabase(join(root, 'app.db'))
  // tasks.lesson_id is an FK to lessons.id, which is an FK to courses.id —
  // both parents must exist before any task row.
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '')").run()
  return { db, root }
}

function seedHandoff(db: Db, taskId: string, updatedAt: string, isBilibili = false): void {
  db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES (?, 'l1', 'failed', ?, ?)").run(
    taskId,
    updatedAt,
    updatedAt
  )
  db.prepare("INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES (?, 'fetching_course', ?)").run(
    taskId,
    JSON.stringify({
      lessonId: 'l1',
      teacherStreamUrl: 'https://vod/t.mp4?auth_key=SECRET',
      ...(isBilibili ? { bilibili: true } : {})
    })
  )
}

const handoffCount = (db: Db, taskId: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM task_stage_outputs WHERE task_id = ? AND stage = 'fetching_course'").get(taskId) as { n: number }).n

describe('签名直链交接的保留期（声明批7）', () => {
  it('删掉已过新鲜期的失败任务交接——那时续跑本来就会重新收割', () => {
    const { db, root } = makeDb()
    const now = Date.now()
    seedHandoff(db, 'stale', new Date(now - 7 * 60 * 60 * 1000).toISOString())
    seedHandoff(db, 'fresh', new Date(now - 1 * 60 * 60 * 1000).toISOString())

    expect(pruneStaleSignedUrlHandoffs(db, now)).toBe(1)
    expect(handoffCount(db, 'stale')).toBe(0)
    // 新鲜的那条必须留着——否则断点续跑会白白重新收割一次。
    expect(handoffCount(db, 'fresh')).toBe(1)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('保留期与续跑用的新鲜窗口是同一对常量（不会各说各话）', () => {
    const { db, root } = makeDb()
    const now = Date.now()
    // 正好卡在 SEU 窗口内侧与外侧各一条，证明清扫用的就是 resume.ts 的常量。
    seedHandoff(db, 'just-inside', new Date(now - STREAM_URL_FRESH_MS + 60_000).toISOString())
    seedHandoff(db, 'just-outside', new Date(now - STREAM_URL_FRESH_MS - 60_000).toISOString())

    expect(pruneStaleSignedUrlHandoffs(db, now)).toBe(1)
    expect(handoffCount(db, 'just-inside')).toBe(1)
    expect(handoffCount(db, 'just-outside')).toBe(0)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('B站流只活 120 分钟——用 6 小时衡量会把早已失效的 URL 多留几个钟头', () => {
    const { db, root } = makeDb()
    const now = Date.now()
    const threeHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString()
    seedHandoff(db, 'bili-old', threeHoursAgo, true)
    seedHandoff(db, 'seu-same-age', threeHoursAgo, false)

    expect(BILI_STREAM_FRESH_MS).toBeLessThan(3 * 60 * 60 * 1000)
    expect(pruneStaleSignedUrlHandoffs(db, now)).toBe(1)
    expect(handoffCount(db, 'bili-old')).toBe(0)
    expect(handoffCount(db, 'seu-same-age')).toBe(1)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('没有时间戳可判断时不动它——宁可留着让续跑自己降级', () => {
    const { db, root } = makeDb()
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t1', 'l1', 'failed', '', '')").run()
    db.prepare("INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t1', 'fetching_course', '{}')").run()

    expect(pruneStaleSignedUrlHandoffs(db, Date.now())).toBe(0)
    expect(handoffCount(db, 't1')).toBe(1)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('只碰 fetching_course：别阶段的交接有别的用处', () => {
    const { db, root } = makeDb()
    const now = Date.now()
    const old = new Date(now - 7 * 60 * 60 * 1000).toISOString()
    db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t1', 'l1', 'failed', ?, ?)").run(old, old)
    db.prepare("INSERT INTO task_stage_outputs (task_id, stage, output_json) VALUES ('t1', 'downloading_video', '{}')").run()

    expect(pruneStaleSignedUrlHandoffs(db, now)).toBe(0)
    const rows = db.prepare("SELECT COUNT(*) AS n FROM task_stage_outputs WHERE task_id = 't1'").get() as { n: number }
    expect(rows.n).toBe(1)
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
})
