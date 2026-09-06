import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { nextPendingChainTask } from '../src/main/bilibili/chain'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-bili-chain-'))
  db = openDatabase(join(dir, 'app.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function insertBiliCourse(courseId: string, pages: Array<{ page: number; cid: string }>): void {
  db.prepare(
    `INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES (?, '课', 'bilibili', 'BV1X', '2026-09-07T00:00:00Z')`
  ).run(courseId)
  for (const { page, cid } of pages) {
    db.prepare(
      `INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, fetched_at) VALUES (?, ?, ?, 'bilibili', ?, ?, '2026-09-07T00:00:00Z')`
    ).run(`${courseId}-P${page}`, courseId, `P${page}`, cid, page)
  }
}

function insertTask(taskId: string, lessonId: string, state: string): void {
  db.prepare(
    "INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES (?, ?, ?, '2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z')"
  ).run(taskId, lessonId, state)
}

describe('nextPendingChainTask (bilibili course auto-chain, usability 2026-09-07)', () => {
  it('returns the lowest-page pending task of the same course', () => {
    insertBiliCourse('b1', [
      { page: 1, cid: '11' },
      { page: 2, cid: '22' },
      { page: 3, cid: '33' }
    ])
    insertTask('t1', 'b1-P1', 'succeeded')
    insertTask('t2', 'b1-P3', 'pending')
    insertTask('t3', 'b1-P2', 'pending')
    expect(nextPendingChainTask(db, 'b1-P1')).toEqual({ taskId: 't3', lessonId: 'b1-P2' })
  })

  it('returns null when the course has no pending rows left', () => {
    insertBiliCourse('b1', [
      { page: 1, cid: '11' },
      { page: 2, cid: '22' }
    ])
    insertTask('t1', 'b1-P1', 'succeeded')
    insertTask('t2', 'b1-P2', 'failed')
    expect(nextPendingChainTask(db, 'b1-P1')).toBeNull()
  })

  it('returns null for a seu lesson (SEU courses never auto-chain)', () => {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课', '2026-09-07T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-07T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '课时二', '2026-09-07T00:00:00Z')").run()
    insertTask('t1', 'l1', 'succeeded')
    insertTask('t2', 'l2', 'pending')
    expect(nextPendingChainTask(db, 'l1')).toBeNull()
  })

  it('returns null when the finished lesson does not exist', () => {
    expect(nextPendingChainTask(db, 'ghost')).toBeNull()
  })
})
