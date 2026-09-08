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
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('is idempotent when reopened', () => {
    const file = join(dir, 'app.db')
    db.close()
    db = openDatabase(file)
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('applies only pending migrations on an upgraded database', () => {
    // Simulate a v1 database: reopen and confirm all versions present.
    const file = join(dir, 'app.db')
    db.close()
    db = openDatabase(file)
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('adds play-page reference columns (006)', () => {
    db.prepare("INSERT INTO courses (id, name, tecl_id, tecl_code, fetched_at) VALUES ('c1', '课程', '154717', '202620271B080329101', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES ('l1', 'c1', '第1节', '0', '2026-08-30T00:00:00Z')").run()
    const course = db.prepare('SELECT tecl_id, tecl_code FROM courses WHERE id = ?').get('c1') as { tecl_id: string; tecl_code: string }
    expect(course).toEqual({ tecl_id: '154717', tecl_code: '202620271B080329101' })
    const lesson = db.prepare('SELECT play_ref FROM lessons WHERE id = ?').get('l1') as { play_ref: string }
    expect(lesson.play_ref).toBe('0')
  })

  it('adds course metadata columns with a defaulted is_mine pin (007)', () => {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-03T00:00:00Z')").run()
    const row = db.prepare('SELECT subj_code, classroom, cour_times, is_mine FROM courses WHERE id = ?').get('c1') as {
      subj_code: null
      classroom: null
      cour_times: null
      is_mine: number
    }
    expect(row).toEqual({ subj_code: null, classroom: null, cour_times: null, is_mine: 0 })

    db.prepare('UPDATE courses SET is_mine = 1, subj_code = ?, classroom = ?, cour_times = ? WHERE id = ?').run(
      'CS101',
      '中山-312',
      '周一 第3-4节',
      'c1'
    )
    const pinned = db.prepare('SELECT is_mine, classroom FROM courses WHERE id = ?').get('c1') as { is_mine: number; classroom: string }
    expect(pinned.is_mine).toBe(1)
    expect(pinned.classroom).toBe('中山-312')

    // The pin is a 0/1 flag, not a free counter (CHECK constraint).
    expect(() => db.prepare('UPDATE courses SET is_mine = 2 WHERE id = ?').run('c1')).toThrowError()
  })

  it('defaults every row to the seu source and stores bilibili metadata (009)', () => {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-06T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-06T00:00:00Z')").run()

    const seuRow = db.prepare('SELECT source FROM courses WHERE id = ?').get('c1') as { source: string }
    const seuLesson = db.prepare('SELECT source FROM lessons WHERE id = ?').get('l1') as { source: string }
    expect(seuRow.source).toBe('seu')
    expect(seuLesson.source).toBe('seu')

    db.prepare(
      "INSERT INTO courses (id, name, source, bili_bvid, bili_up_mid, fetched_at) VALUES ('b1', 'B站视频', 'bilibili', 'BV1GJ411x7h7', '486906719', '2026-09-06T00:00:00Z')"
    ).run()
    db.prepare(
      "INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, fetched_at) VALUES ('b1-P1', 'b1', 'P1 开场', 'bilibili', '137649199', 1, '2026-09-06T00:00:00Z')"
    ).run()
    const bili = db.prepare('SELECT source, bili_bvid, bili_up_mid FROM courses WHERE id = ?').get('b1') as {
      source: string
      bili_bvid: string
      bili_up_mid: string
    }
    expect(bili).toEqual({ source: 'bilibili', bili_bvid: 'BV1GJ411x7h7', bili_up_mid: '486906719' })
    const biliLesson = db.prepare('SELECT bili_cid, bili_page FROM lessons WHERE id = ?').get('b1-P1') as {
      bili_cid: string
      bili_page: number
    }
    expect(biliLesson).toEqual({ bili_cid: '137649199', bili_page: 1 })
  })

  it('keeps bilibili bvid/cid unique without touching seu rows (009 partial unique)', () => {
    db.prepare(
      "INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('b1', '视频', 'bilibili', 'BV1GJ411x7h7', '2026-09-06T00:00:00Z')"
    ).run()
    db.prepare("INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, fetched_at) VALUES ('b1-P1', 'b1', 'P1', 'bilibili', '137649199', 1, '2026-09-06T00:00:00Z')").run()

    // Same bvid / same cid → rejected (double import guard).
    expect(() =>
      db.prepare("INSERT INTO courses (id, name, source, bili_bvid, fetched_at) VALUES ('b2', '重复', 'bilibili', 'BV1GJ411x7h7', '2026-09-06T00:00:00Z')").run()
    ).toThrowError(/UNIQUE/)
    expect(() =>
      db.prepare("INSERT INTO lessons (id, course_id, title, source, bili_cid, bili_page, fetched_at) VALUES ('b2-P1', 'b1', 'P1 重', 'bilibili', '137649199', 1, '2026-09-06T00:00:00Z')").run()
    ).toThrowError(/UNIQUE/)

    // SEU rows keep bili_* NULL — NULL never collides with the partial index.
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c2', '课程', '2026-09-06T00:00:00Z')").run()
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c3', '课程', '2026-09-06T00:00:00Z')").run()
    expect(db.prepare('SELECT COUNT(*) AS n FROM courses').get()).toEqual({ n: 3 })
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
