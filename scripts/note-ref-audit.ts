/**
 * 真实数据只读核验：用新的核验逻辑 + 体检跑各笔记，给出可核验率 / at 越界 / 邻域违例 /
 * warn 数 / 内容规模的真数字。
 *
 * 只读打开指定库（缺省用真实库），绝不写入。
 *
 *   npx vite-node scripts/note-ref-audit.ts [dbPath] [--label=重生成前]
 */
import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import { cleanSegments, formatTimedTranscript } from '../src/shared/notes/transcript-clean'
import { verifyNoteRefs, transcriptRefHitRate } from '../src/shared/notes/ref-verify'
import { noteHealth } from '../src/shared/notes/health'
import { parseNote } from '../src/shared/notes/schema'

const argPath = process.argv.slice(2).find((a) => !a.startsWith('--'))
const labelArg = process.argv.find((a) => a.startsWith('--label='))
const label = labelArg != null ? labelArg.slice('--label='.length) : ''
const DB = argPath ?? join(homedir(), 'Documents', 'SEU Summary', 'Library', 'app.db')

const db = new Database(DB, { readonly: true })
console.log(`只读核验：${DB}${label !== '' ? `  【${label}】` : ''}\n`)

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
  const transcript = db.prepare('SELECT segments_json FROM transcripts WHERE lesson_id = ?').get(row.lesson_id) as
    | { segments_json: string }
    | undefined
  const note = parseNote(row.note_json)
  const rawSegments =
    transcript != null ? (JSON.parse(transcript.segments_json) as Array<{ at?: number; text?: string }>) : []
  const segments = cleanSegments(rawSegments)
  const timed = formatTimedTranscript(segments)

  const { note: _verified, stats } = verifyNoteRefs(note, segments)
  const hitRate = transcriptRefHitRate(stats)
  const health = noteHealth(note)
  const totalRefs =
    note.timeline.reduce((acc, e) => acc + e.refs.length, 0) +
    note.concepts.reduce((acc, c) => acc + c.refs.length, 0) +
    note.formulasAndSteps.reduce((acc, f) => acc + f.refs.length, 0)
  const refsWithText = [
    ...note.timeline.flatMap((e) => e.refs),
    ...note.concepts.flatMap((c) => c.refs),
    ...note.formulasAndSteps.flatMap((f) => f.refs)
  ].filter((r) => r.text.trim() !== '').length

  console.log(`${row.lesson_id}  v${row.version}`)
  console.log(`  体检: ${health.grade}（warn ${health.warnCount}）`)
  console.log(
    `  内容: 概念 ${note.concepts.length}（带例子 ${note.concepts.filter((c) => c.example != null && c.example.trim() !== '').length}）/ 时间线 ${note.timeline.length} / 公式步骤 ${note.formulasAndSteps.length} / quiz ${note.quiz.length} / 关联 ${note.conceptLinks.length}`
  )
  console.log(`  转写: 原始 ${rawSegments.length} 片 → 清洗 ${segments.length} → 带时间锚 ${timed.split('\n').filter((l) => l.startsWith('[')).length} 行`)
  console.log(`  refs 总数 ${totalRefs}（其中带摘引 ${refsWithText}）`)
  console.log(
    `  可核验率: ${hitRate == null ? '无可判摘引' : `${hitRate.hits}/${hitRate.total} = ${Math.round((hitRate.hits / hitRate.total) * 100)}%`}`
  )
  console.log(`  at 越界 ${stats.droppedAt} / 摘引不匹配被清空 ${stats.clearedText} / 邻域违例 ${stats.offNeighborhood}`)
  console.log('')
}

db.close()
