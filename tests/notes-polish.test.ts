import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { saveNoteVersion } from '../src/main/notes/summarize'
import { buildPolishUserParts, polishNote } from '../src/main/notes/polish'
import { FEEDBACK_TAGS, feedbackTagInstructions } from '../src/shared/feedback-tags'
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
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-notes-polish-'))
  db = openDatabase(':memory:')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('saveNoteVersion F6 版本剪枝 (plan 2026-09-07 v07)', () => {
  it('keeps only the newest 10 versions — regeneration/polish no longer grow the table unbounded', () => {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c', '课程', '2026-09-08T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c', '课时', '2026-09-08T00:00:00Z')").run()
    for (let i = 0; i < 12; i += 1) {
      saveNoteVersion(db, 'l1', MIN_NOTE, `m${i}`)
    }
    const rows = db.prepare('SELECT version FROM notes WHERE lesson_id = ? ORDER BY version').all('l1') as Array<{ version: number }>
    expect(rows.map((r) => r.version)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(rows).toHaveLength(10)
  })
})

describe('feedbackTagInstructions (批5)', () => {
  it('maps tag ids to their prompt instructions and ignores unknown ids', () => {
    expect(feedbackTagInstructions(['too_brief', 'bogus', 'lacks_examples'])).toEqual([
      FEEDBACK_TAGS[0]!.instruction,
      FEEDBACK_TAGS[2]!.instruction
    ])
    expect(feedbackTagInstructions([])).toEqual([])
  })
})

describe('buildPolishUserParts (批5)', () => {
  it('carries the original note, tag instructions, free text, and valid refs', () => {
    const message = buildPolishUserParts(MIN_NOTE, { tags: ['too_brief'], text: '再展开讲讲第 3 节' }, '转写内容片段', ['kf:kf-1'])
    expect(message).toContain('【原笔记 JSON】')
    expect(message).toContain('"overview"')
    expect(message).toContain(FEEDBACK_TAGS[0]!.instruction)
    expect(message).toContain('补充说明：再展开讲讲第 3 节')
    expect(message).toContain('转写内容片段')
    expect(message).toContain('kf:kf-1')
  })

  it('an empty selection degrades to an honest overall-pass instruction', () => {
    const message = buildPolishUserParts(MIN_NOTE, { tags: [], text: '' }, '', [])
    expect(message).toContain('整体的查漏与润饰')
    expect(message).toContain('（无转写，仅以原笔记为准）')
  })
})

describe('polishNote (批5)', () => {
  function seedLesson(): void {
    db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-09-08T00:00:00Z')").run()
    db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时', '2026-09-08T00:00:00Z')").run()
    db.prepare("INSERT INTO providers (id, name, base_url, api_key, created_at) VALUES ('p1', '测试', 'http://x', 'k', '2026-09-08T00:00:00Z')").run()
    db.prepare("INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES ('kf-1', 'l1', 120, 'kf.jpg', 'h', '2026-09-08T00:00:00Z')").run()
  }

  function seedLatestNote(): void {
    saveNoteVersion(db, 'l1', MIN_NOTE, 'mimo-v2.5')
  }

  const clientOf = (answer: string): { chatJson: ReturnType<typeof vi.fn> } => ({
    chatJson: vi.fn(async () => answer)
  })

  it('inserts the revised note as version N+1 with a polish-marked model', async () => {
    seedLesson()
    seedLatestNote()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'mimo-v2.5')").run()
    const revised = parseNote(JSON.stringify({ ...MIN_NOTE, overview: '润色后的更完整概览' }))
    const client = clientOf(JSON.stringify(revised))
    const result = await polishNote(db, client as never, 'l1', { tags: ['too_brief'], text: '' })
    if (!('error' in result)) {
      expect(result.version).toBe(2)
      const row = db.prepare('SELECT model, note_json FROM notes WHERE lesson_id = ? AND version = 2').get('l1') as { model: string; note_json: string }
      expect(row.model).toContain('润色')
      expect((JSON.parse(row.note_json) as Note).overview).toContain('润色后')
    } else {
      throw new Error(`polish failed: ${result.error}`)
    }
  })

  it('fabricated refs in the polished output are dropped before persisting', async () => {
    seedLesson()
    seedLatestNote()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'm')").run()
    const fabricated = parseNote(
      JSON.stringify({
        ...MIN_NOTE,
        timeline: [{ at: 130, title: 't', detail: 'd', evidence: [{ kind: 'keyframe', ref: 'kf:made-up' }] }]
      })
    )
    const client = clientOf(JSON.stringify(fabricated))
    const result = await polishNote(db, client as never, 'l1', { tags: ['lacks_detail'], text: '' })
    expect('droppedRefs' in result && result.droppedRefs).toBe(1)
    const row = db.prepare('SELECT note_json FROM notes WHERE lesson_id = ? AND version = 2').get('l1') as { note_json: string }
    expect(row.note_json).not.toContain('made-up')
  })

  it('refuses when the lesson has no note yet', async () => {
    seedLesson()
    db.prepare("INSERT INTO capability_bindings (capability, provider_id, model) VALUES ('multimodal', 'p1', 'm')").run()
    const result = await polishNote(db, { chatJson: async () => '' } as never, 'l1', { tags: ['too_brief'], text: '' })
    expect('error' in result && result.error).toContain('还没有笔记')
  })

  it('refuses when no multimodal model is bound', async () => {
    seedLesson()
    seedLatestNote()
    const result = await polishNote(db, { chatJson: async () => '' } as never, 'l1', { tags: ['too_brief'], text: '' })
    expect('error' in result && result.error).toContain('未绑定')
  })
})
