import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { claimNoteInflight, releaseNoteInflight } from '../src/main/notes/inflight'
import { saveNoteVersion } from '../src/main/notes/summarize'
import { parseNote, type Note } from '../src/shared/notes/schema'

const MIN_NOTE: Note = parseNote(
  JSON.stringify({
    overview: '本讲概览',
    knowledgeTree: { title: 'root', children: [{ title: 'child', children: [] }] },
    timeline: [{ at: 120, title: 't', detail: 'd', evidence: [{ kind: 'keyframe', ref: 'kf:kf-1' }] }],
    methodology: '方法'
  })
)

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-notes-inflight-'))
  db = openDatabase(':memory:')
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-19T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-19T00:00:00Z')").run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  releaseNoteInflight('l1')
  releaseNoteInflight('l2')
})

describe('claimNoteInflight / releaseNoteInflight (批5: polish × regenerate 互斥)', () => {
  it('first claim wins, a second claim for the same lesson is refused', () => {
    expect(claimNoteInflight('l1', 'polish')).toBe(true)
    expect(claimNoteInflight('l1', 'regenerate')).toBe(false)
    expect(claimNoteInflight('l2', 'regenerate')).toBe(true)
  })

  it('release frees the lesson for the next flow', () => {
    expect(claimNoteInflight('l1', 'polish')).toBe(true)
    releaseNoteInflight('l1')
    expect(claimNoteInflight('l1', 'regenerate')).toBe(true)
  })
})

describe('saveNoteVersion 事务原子性 (批5)', () => {
  it('a failure mid-sequence rolls the whole version insert back — no half-written version row', () => {
    // Simulate the prune DELETE blowing up after the INSERT ran: the
    // transaction must undo both so the next call re-computes the same
    // version (a surviving INSERT would fork the version sequence).
    const realPrepare = db.prepare.bind(db)
    let armed = true
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = realPrepare(sql)
      if (armed && sql.startsWith('DELETE FROM notes')) {
        return {
          ...stmt,
          run: () => {
            throw new Error('injected prune failure')
          }
        } as unknown as typeof stmt
      }
      return stmt
    })

    expect(() => saveNoteVersion(db, 'l1', MIN_NOTE, 'm1')).toThrowError(/injected prune failure/)
    armed = false
    vi.restoreAllMocks()

    // Nothing persisted: the version sequence starts clean at 1.
    expect((db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n).toBe(0)
    expect(saveNoteVersion(db, 'l1', MIN_NOTE, 'm2')).toBe(1)
  })
})
