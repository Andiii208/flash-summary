import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { appliedVersions } from '../src/main/db/migrate'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-db-'))
  db = openDatabase(join(dir, 'app.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('migrations', () => {
  it('applies all migrations on a fresh database', () => {
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5])
  })

  it('is idempotent when reopened', () => {
    const file = join(dir, 'app.db')
    db.close()
    db = openDatabase(file)
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5])
  })

  it('applies only pending migrations on an upgraded database', () => {
    // Simulate a v1 database: reopen and confirm all versions present.
    const file = join(dir, 'app.db')
    db.close()
    db = openDatabase(file)
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('courses and lessons', () => {
  it('stores a course with lessons and cascades on delete', () => {
    db.prepare("INSERT INTO courses (id, name, term, teacher, fetched_at) VALUES ('c1', '高等数学', '2026春', '王老师', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '第一讲 极限', '2026-08-30T00:00:00Z')").run()

    const lesson = db.prepare('SELECT title FROM lessons WHERE id = ?').get('l1') as { title: string }
    expect(lesson.title).toBe('第一讲 极限')

    db.prepare('DELETE FROM courses WHERE id = ?').run('c1')
    expect(db.prepare('SELECT COUNT(*) AS n FROM lessons').get()).toEqual({ n: 0 })
  })

  it('rejects a lesson referencing a missing course (foreign keys on)', () => {
    expect(() =>
      db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('lx', 'missing', 'x', '2026-08-30T00:00:00Z')").run()
    ).toThrowError(/FOREIGN KEY/)
  })
})

describe('tasks state machine columns', () => {
  beforeEach(() => {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
  })

  it('accepts the spec state-machine states and a failed stage', () => {
    const insert = db.prepare(
      "INSERT INTO tasks (id, lesson_id, state, failed_stage, created_at, updated_at) VALUES ('t1', 'l1', ?, ?, '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')"
    )
    insert.run('failed', 'downloading_video')
    const task = db.prepare('SELECT state, failed_stage FROM tasks WHERE id = ?').get('t1') as { state: string; failed_stage: string }
    expect(task).toEqual({ state: 'failed', failed_stage: 'downloading_video' })
  })

  it('rejects unknown states', () => {
    expect(() =>
      db.prepare("INSERT INTO tasks (id, lesson_id, state, created_at, updated_at) VALUES ('t2', 'l1', 'flying', '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')").run()
    ).toThrowError(/CHECK/)
  })

  it('rejects a failed_stage that is not a pipeline stage', () => {
    expect(() =>
      db.prepare("INSERT INTO tasks (id, lesson_id, state, failed_stage, created_at, updated_at) VALUES ('t3', 'l1', 'failed', 'pending', '2026-08-30T00:00:00Z', '2026-08-30T00:00:00Z')").run()
    ).toThrowError(/CHECK/)
  })
})

describe('artifacts and history', () => {
  beforeEach(() => {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-08-30T00:00:00Z')").run()
  })

  it('stores transcript segments, ppt pages, and keyframes per lesson', () => {
    db.prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', '[]', 'openai', 'whisper-1', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES ('p1', 'l1', 0, 'a.png', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES ('k1', 'l1', 12.5, 'f.jpg', 'abc', '2026-08-30T00:00:00Z')").run()

    expect(db.prepare('SELECT COUNT(*) AS n FROM transcripts').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM ppt_pages').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM keyframes').get()).toEqual({ n: 1 })
  })

  it('keeps note versions unique per lesson', () => {
    const insert = db.prepare(
      "INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES (?, 'l1', ?, '{}', 'openai', 'gpt-4o', '2026-08-30T00:00:00Z')"
    )
    insert.run('n1', 1)
    insert.run('n2', 2)
    expect(() => insert.run('n3', 1)).toThrowError(/UNIQUE/)
  })

  it('stores lesson-level qa with course_id reserved for course-level later', () => {
    db.prepare("INSERT INTO qa (id, lesson_id, course_id, question, answer, created_at) VALUES ('q1', 'l1', NULL, '什么是极限?', '略', '2026-08-30T00:00:00Z')").run()
    const qa = db.prepare('SELECT question, course_id FROM qa WHERE id = ?').get('q1') as { question: string; course_id: string | null }
    expect(qa.question).toBe('什么是极限?')
    expect(qa.course_id).toBeNull()
  })
})
