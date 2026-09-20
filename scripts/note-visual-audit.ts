/**
 * 视觉供给链只读核验（plan 2026-09-19-note-experience-overhaul 批 0）。
 *
 * 对真实库每条最新版笔记输出：
 *   - 帧数 / 帧时间跨度 / PPT 页数 / extracting_visuals 的 skipped 原因（断供可见化取证）
 *   - 时间线条目在「90s 就近筛子」下的配图率（复用产品码 bindTimelineImages，不另写判据）
 *   - timeline.at 是否超出转写范围（越界编造取证）
 *   - 当前 multimodal 绑定模型（能力匹配取证）
 *
 * 只读打开指定库（缺省真实库），绝不写入。
 *
 *   npx vite-node scripts/note-visual-audit.ts [dbPath]
 */
import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import { cleanSegments } from '../src/shared/notes/transcript-clean'
import { bindTimelineImages, type AttachmentLike } from '../src/shared/notes/evidence'
import { parseNote } from '../src/shared/notes/schema'
import { TIME_WINDOW_SECONDS } from '../src/shared/notes/transcript-clean'

const argPath = process.argv.slice(2).find((a) => !a.startsWith('--'))
const DB = argPath ?? join(homedir(), 'Documents', 'SEU Summary', 'Library', 'app.db')

const db = new Database(DB, { readonly: true })
console.log(`视觉供给链只读核验：${DB}\n`)

const bindings = db.prepare('SELECT capability, provider_id, model FROM capability_bindings').all() as Array<{
  capability: string
  provider_id: string
  model: string
}>
console.log(`multimodal 绑定: ${bindings.filter((b) => b.capability === 'multimodal').map((b) => `${b.provider_id}/${b.model}`).join(', ') || '（未绑定）'}`)
console.log(`asr 绑定:        ${bindings.filter((b) => b.capability === 'asr').map((b) => `${b.provider_id}/${b.model}`).join(', ') || '（未绑定）'}\n`)

interface NoteRow {
  lesson_id: string
  version: number
  note_json: string
}
const rows = db
  .prepare(
    'SELECT lesson_id, version, note_json FROM notes WHERE version = (SELECT MAX(version) FROM notes n2 WHERE n2.lesson_id = notes.lesson_id) ORDER BY lesson_id'
  )
  .all() as NoteRow[]

for (const row of rows) {
  const note = parseNote(row.note_json)
  const keyframes = db
    .prepare('SELECT timestamp_seconds FROM keyframes WHERE lesson_id = ? ORDER BY timestamp_seconds')
    .all(row.lesson_id) as Array<{ timestamp_seconds: number }>
  const pptCount = (db.prepare('SELECT COUNT(*) AS n FROM ppt_pages WHERE lesson_id = ?').get(row.lesson_id) as { n: number }).n
  const transcript = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(row.lesson_id) as
    | { segments_json: string }
    | undefined

  // 90s 就近筛子的真实配图率：dataUrl 为空串不影响绑定判定（谓词只看 ref/kind/at）。
  const attachments: AttachmentLike[] = keyframes.map((k, i) => ({
    ref: `kf:${i}`,
    kind: 'keyframe' as const,
    at: Math.round(k.timestamp_seconds),
    dataUrl: ''
  }))
  const withImage = note.timeline.filter((entry) => bindTimelineImages(entry, attachments).length > 0).length
  const citedEvidence = new Set(note.timeline.flatMap((e) => e.evidence.map((x) => x.ref))).size

  let rangeMax: number | null = null
  if (transcript != null) {
    try {
      const segments = cleanSegments(JSON.parse(transcript.segments_json) as Array<{ at?: number; text?: string }>)
      for (const s of segments) if (s.at != null) rangeMax = Math.max(rangeMax ?? 0, s.at)
      if (rangeMax != null) rangeMax += TIME_WINDOW_SECONDS
    } catch {
      /* 坏转写不阻断核验 */
    }
  }
  const atBeyond = rangeMax == null ? 0 : note.timeline.filter((e) => e.at > rangeMax).length

  const stage = db
    .prepare('SELECT output_json FROM task_stage_outputs WHERE task_id = (SELECT id FROM tasks WHERE lesson_id = ? AND state = ? ORDER BY created_at DESC LIMIT 1) AND stage = ?')
    .get(row.lesson_id, 'succeeded', 'extracting_visuals') as { output_json: string } | undefined

  const kfSpan = keyframes.length > 0 ? `${Math.round(keyframes[0]!.timestamp_seconds)}s ~ ${Math.round(keyframes[keyframes.length - 1]!.timestamp_seconds)}s` : '—'
  console.log(`${row.lesson_id}  v${row.version}`)
  console.log(`  视觉素材: 帧 ${keyframes.length}（${kfSpan}）/ PPT 页 ${pptCount} / 抽帧阶段产物 ${stage?.output_json ?? '（无记录）'}`)
  console.log(
    `  配图率: ${withImage}/${note.timeline.length} 条时间线有图（90s 就近筛子）/ 模型主动引用 evidence ${citedEvidence} 个 ref`
  )
  console.log(`  timeline.at 越界: ${atBeyond} 条（转写范围上界 ${rangeMax ?? '—'}s）`)
  console.log('')
}

db.close()
