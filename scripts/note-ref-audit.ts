/**
 * 批1 真实数据核验（只读）：用新的核验逻辑跑真实库三份笔记的转写锚，
 * 给出「可核验率 / at 越界 / 邻域违例 / 摘引被清空」的真数字。
 *
 * 只读打开真实库，绝不写入。运行：npx vite-node scripts/note-ref-audit.ts
 */
import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import { cleanSegments, formatTimedTranscript } from '../src/shared/notes/transcript-clean'
import { verifyNoteRefs, transcriptRefHitRate } from '../src/shared/notes/ref-verify'
import { parseNote } from '../src/shared/notes/schema'

const DB = join(homedir(), 'Documents', 'SEU Summary', 'Library', 'app.db')
const db = new Database(DB, { readonly: true })

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

console.log(`真实库只读核验：${rows.length} 份笔记（最高版本）\n`)

for (const row of rows) {
  const transcript = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(row.lesson_id) as
    | { segments_json: string }
    | undefined
  const note = parseNote(row.note_json)
  const rawSegments = transcript != null ? (JSON.parse(transcript.segments_json) as Array<{ at?: number; text?: string }>) : []
  const segments = cleanSegments(rawSegments)
  const timed = formatTimedTranscript(segments)

  const totalRefs =
    note.timeline.reduce((acc, e) => acc + e.refs.length, 0) +
    note.concepts.reduce((acc, c) => acc + c.refs.length, 0) +
    note.formulasAndSteps.reduce((acc, f) => acc + f.refs.length, 0)
  const timelineRefs = note.timeline.reduce((acc, e) => acc + e.refs.length, 0)

  const { stats } = verifyNoteRefs(note, segments)
  const hitRate = transcriptRefHitRate(stats)

  console.log(`${row.lesson_id}  v${row.version}`)
  console.log(`  转写分片 ${rawSegments.length} → 清洗后 ${segments.length}；带时间锚的行 ${timed.split('\n').filter((l) => l.startsWith('[')).length}`)
  console.log(`  带 at 的分片: ${rawSegments.filter((s) => typeof s.at === 'number').length}/${rawSegments.length}`)
  console.log(`  refs 总数 ${totalRefs}（timeline ${timelineRefs}）`)
  console.log(`  可核验率: ${hitRate == null ? '无可判摘引（模型没写摘引）' : `${hitRate.hits}/${hitRate.total} = ${Math.round((hitRate.hits / hitRate.total) * 100)}%`}`)
  console.log(`  at 越界被丢弃 ${stats.droppedAt} / 摘引匹配不上被清空 ${stats.clearedText} / 邻域违例 ${stats.offNeighborhood}`)
  console.log('')
}

db.close()
