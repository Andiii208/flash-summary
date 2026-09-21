import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, type Db } from '../src/main/db/open'
import { assembleContext, buildQaMessages, recordQa } from '../src/main/notes/qa'
import { parseNote } from '../src/main/notes/schema'

let db: Db
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-qa-'))
  db = openDatabase(join(dir, 'app.db'))
  db.prepare("INSERT INTO courses (id, name, fetched_at) VALUES ('c1', '课程', '2026-08-30T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l1', 'c1', '课时一', '2026-08-30T00:00:00Z')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, fetched_at) VALUES ('l2', 'c1', '课时二', '2026-08-30T00:00:00Z')").run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const note = parseNote(
  JSON.stringify({
    overview: '极限入门',
    knowledgeTree: { title: '极限', children: [] },
    methodology: '直观→严格→计算',
    examCues: [],
    questionsAndGaps: []
  })
)

describe('context assembly (current lesson only)', () => {
  it('collects transcript, evidence, and prior qa for the lesson', () => {
    db.prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', '[{\"at\":0,\"text\":\"开场部分我们回顾上一讲\"},{\"at\":10,\"text\":\"我们定义极限的概念\"}]', 'openai', 'whisper-1', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES ('p1', 'l1', 0, 'a.png', '2026-08-30T00:00:00Z')").run()
    db.prepare("INSERT INTO keyframes (id, lesson_id, timestamp_seconds, file_path, hash, created_at) VALUES ('k1', 'l1', 12, 'f.jpg', 'h', '2026-08-30T00:00:00Z')").run()
    recordQa(db, 'l1', '什么是极限?', '一种无限接近的过程')

    const ctx = assembleContext(db, 'l1', note)
    expect(ctx.lessonId).toBe('l1')
    expect(ctx.transcriptText).toContain('定义极限')
    expect(ctx.evidenceIds).toEqual(['ppt:0', 'kf:k1'])
    expect(ctx.priorQa).toEqual([{ question: '什么是极限?', answer: '一种无限接近的过程' }])
  })

  it('does not include other lessons qa or artifacts (lesson boundary)', () => {
    recordQa(db, 'l2', '课时二的问题', '课时二的答案')
    db.prepare("INSERT INTO ppt_pages (id, lesson_id, page_index, file_path, created_at) VALUES ('p2', 'l2', 0, 'b.png', '2026-08-30T00:00:00Z')").run()

    const ctx = assembleContext(db, 'l1', note)
    expect(ctx.priorQa).toEqual([])
    expect(ctx.evidenceIds).toEqual([])
  })

  it('handles a lesson with no artifacts at all (note only)', () => {
    // P37 (plan 2026-09-21): note 不可空——qa:ask 在查不到笔记行时直接拒绝，
    // 「无笔记也放行」的形态已不可达；本用例保住「没有任何素材」的覆盖。
    const ctx = assembleContext(db, 'l1', note)
    expect(ctx.transcriptText).toBe('')
    expect(ctx.evidenceIds).toEqual([])
    expect(ctx.priorQa).toEqual([])
  })
})

describe('qa message building', () => {
  it('includes lesson scoping, note, transcript, evidence, and prior qa', () => {
    db.prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', '[{\"at\":0,\"text\":\"开场部分我们讲极限思想\"}]', 'openai', 'whisper-1', '2026-08-30T00:00:00Z')").run()
    recordQa(db, 'l1', '第一问', '第一答')

    const ctx = assembleContext(db, 'l1', note)
    const messages = buildQaMessages(ctx, 'ε-δ 是什么?')

    const user = messages.find((m) => m.role === 'user')!.content
    expect(user).toContain('l1')
    expect(user).toContain('极限入门')
    expect(user).toContain('开场')
    expect(user).toContain('第一问')
    expect(user).toContain('ε-δ 是什么?')
  })

  it('truncates very long transcripts to the cap', () => {
    const longText = Array.from({ length: 2000 }, (_, i) => `片段${i}`).join('\n')
    db.prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', ?, 'openai', 'whisper-1', '2026-08-30T00:00:00Z')").run(
      JSON.stringify([{ at: 0, text: longText }])
    )
    const ctx = assembleContext(db, 'l1', note)
    expect(ctx.transcriptText.length).toBeLessThanOrEqual(24_000)
  })

  // P37 (plan 2026-09-21): 批C 的「无笔记无转写 → 仅可回答一般性问题」分支已删
  // （用户明示「不如直接去问网页 AI」，只保留针对笔记的追问）。改写自原两条
  // null-note 用例——「材料缺失话术不再出现」这条性质按新契约钉住。
  it('P37: 有笔记无转写时，上下文只有笔记与课时范围（不再出现材料缺失/一般性问题话术）', () => {
    const ctx = assembleContext(db, 'l1', note)
    const user = buildQaMessages(ctx, '这节课讲了什么?').find((m) => m.role === 'user')!.content
    expect(user).toContain('极限入门')
    expect(user).not.toContain('尚无笔记与转写材料')
    expect(user).not.toContain('一般性问题')
  })

  it('P37: 有转写时转写照常进上下文，同样不出现材料缺失话术', () => {
    db.prepare("INSERT INTO transcripts (lesson_id, segments_json, provider, model, created_at) VALUES ('l1', '[{\"at\":0,\"text\":\"开场部分我们讲极限思想\"}]', 'openai', 'whisper-1', '2026-08-30T00:00:00Z')").run()
    const ctx = assembleContext(db, 'l1', note)
    const user = buildQaMessages(ctx, '这节课讲了什么?').find((m) => m.role === 'user')!.content
    expect(user).not.toContain('尚无笔记与转写材料')
    expect(user).toContain('开场')
  })
})

describe('recordQa', () => {
  it('persists exchanges with course_id reserved as NULL', () => {
    const id = recordQa(db, 'l1', '问', '答')
    const row = db.prepare('SELECT lesson_id, course_id, question FROM qa WHERE id = ?').get(id) as { lesson_id: string; course_id: string | null; question: string }
    expect(row.lesson_id).toBe('l1')
    expect(row.course_id).toBeNull()
    expect(row.question).toBe('问')
  })
})
