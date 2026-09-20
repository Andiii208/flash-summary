/**
 * Obsidian export (plan 2026-09-08-obsidian-export 批1+批2): main-process
 * file plumbing behind notes:exportObsidian / notes:exportCourseObsidian.
 * Vault resolution order: settings key > SEU_OBSIDIAN_PATH test seam >
 * directory picker (persisted on first use). Everything else is idempotent:
 * the same lesson overwrites its file, renames clean up stale files, the
 * per-course concept index and the vault-wide index are rebuilt from the
 * library database on every course export.
 */
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import type { Db } from '../db/open'
import { resolveLibraryPath } from '../library/paths'
import { getSetting, setSetting } from '../settings/store'
import { parseNote } from '../../shared/notes/schema'
import { projectObsidianNote, projectConceptIndex, projectVaultIndex, type ObsidianMeta, type ObsidianAttachment } from '../../shared/notes/obsidian'
import { safeFileName } from '../../shared/notes/export-name'

export const OBSIDIAN_VAULT_KEY = 'obsidianVaultPath'
/** Everything lands in one recognizable subfolder — deletable as a unit. */
export const OBSIDIAN_ROOT_DIR = 'Flash Summary'

/** Latest note per lesson of a course (skips lessons without notes). */
function latestCourseNotes(db: Db, courseId: string): Array<{ lessonId: string; lessonTitle: string; version: number; created_at: string; note_json: string }> {
  return db
    .prepare(
      `SELECT l.id AS lessonId, l.title AS lessonTitle, n.version, n.created_at, n.note_json
       FROM lessons l
       JOIN notes n ON n.lesson_id = l.id
       WHERE l.course_id = ? AND n.version = (SELECT MAX(version) FROM notes WHERE lesson_id = l.id)
       ORDER BY l.title`
    )
    .all(courseId) as Array<{ lessonId: string; lessonTitle: string; version: number; created_at: string; note_json: string }>
}

/** Resolved vault root, or a canceled marker when the user backs out. */
export async function resolveObsidianVault(db: Db): Promise<{ vault: string } | { canceled: true }> {
  const stored = getSetting(db, OBSIDIAN_VAULT_KEY, '')
  if (stored !== '') return { vault: stored }
  const seam = process.env.SEU_OBSIDIAN_PATH
  if (seam != null && seam !== '') return { vault: seam }
  const win = BrowserWindow.getFocusedWindow()
  const options: OpenDialogOptions = { title: '选择 Obsidian 仓库（vault）根目录', properties: ['openDirectory', 'createDirectory'] }
  const picked = win == null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(win, options)
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const vault = picked.filePaths[0] as string
  setSetting(db, OBSIDIAN_VAULT_KEY, vault)
  return { vault }
}

/** Attachments the note actually cites, with their library-relative sources. */
function citedAttachments(db: Db, lessonId: string, noteJson: string): { attachments: ObsidianAttachment[]; refToFile: Map<string, string> } {
  const note = parseNote(noteJson)
  const cited = new Set<string>()
  for (const entry of note.timeline) for (const ev of entry.evidence) cited.add(ev.ref)
  for (const ev of note.evidence) cited.add(ev.ref)
  const refToFile = new Map<string, string>()
  for (const page of db.prepare('SELECT page_index, file_path FROM ppt_pages WHERE lesson_id = ?').all(lessonId) as Array<{ page_index: number; file_path: string }>) {
    refToFile.set(`ppt:${page.page_index}`, page.file_path)
  }
  for (const keyframe of db.prepare('SELECT id, file_path FROM keyframes WHERE lesson_id = ?').all(lessonId) as Array<{ id: string; file_path: string }>) {
    refToFile.set(`kf:${keyframe.id}`, keyframe.file_path)
  }
  const attachments = [...cited]
    .filter((ref) => refToFile.has(ref))
    .map((ref) => ({ ref, name: `${lessonId}-${basename(refToFile.get(ref)!)}` }))
  return { attachments, refToFile }
}

/** 批3 (P23): 一次整课导出里某一篇写失败（lessonId + 可读原因）。 */
export interface ObsidianExportFailure {
  lessonId: string
  reason: string
}

/** 失败原因截断上限——足够看懂，又不把整段栈灌进 toast 与日志行。 */
const FAILURE_REASON_MAX = 200

/**
 * 批3 (P23): 「该课时还没笔记」是**合法状态**，不是失败——用它把整课导出里的
 * 「跳过」与「写失败」分开（此前 catch 是空的，两者都只体现为 skipped +1）。
 */
export class LessonHasNoNoteError extends Error {
  constructor() {
    super('该课时尚无笔记')
    this.name = 'LessonHasNoNoteError'
  }
}

/** 异常 → 一行可读原因（截断；空消息退化成「未知原因」）。 */
function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const trimmed = message.trim()
  return (trimmed === '' ? '未知原因' : trimmed).slice(0, FAILURE_REASON_MAX)
}

/** Write one lesson's structured markdown into the vault; idempotent per lesson. */
export function exportLessonToObsidian(db: Db, libraryRoot: string, lessonId: string, vault: string): { path: string; version: number } {
  const row = db
    .prepare(
      `SELECT n.version, n.created_at, n.note_json, l.title AS lessonTitle, c.name AS courseName, c.source, c.bili_bvid
       FROM notes n
       JOIN lessons l ON l.id = n.lesson_id
       JOIN courses c ON c.id = l.course_id
       WHERE n.lesson_id = ? ORDER BY n.version DESC LIMIT 1`
    )
    .get(lessonId) as { version: number; created_at: string; note_json: string; lessonTitle: string | null; courseName: string | null; source: string | null; bili_bvid: string | null } | undefined
  if (row == null) throw new LessonHasNoNoteError()
  const { attachments, refToFile } = citedAttachments(db, lessonId, row.note_json)
  const meta: ObsidianMeta = {
    course: row.courseName ?? '课程',
    lesson: row.lessonTitle ?? lessonId,
    lessonId,
    origin: row.source === 'bilibili' ? 'bilibili' : 'seu',
    bvid: row.bili_bvid,
    version: row.version,
    created: row.created_at,
    attachments
  }
  const note = parseNote(row.note_json)
  const projection = projectObsidianNote(note, meta)
  const courseDir = join(vault, OBSIDIAN_ROOT_DIR, safeFileName(meta.course))
  const lessonPath = join(courseDir, `${safeFileName(meta.lesson)}.md`)
  const previous = db.prepare('SELECT vault_path, file_path FROM obsidian_exports WHERE lesson_id = ?').get(lessonId) as
    | { vault_path: string; file_path: string }
    | undefined
  if (previous != null && previous.vault_path === vault && previous.file_path !== lessonPath) {
    // Lesson renamed: the new file lands below, the stale one goes away.
    rmSync(previous.file_path, { force: true })
  }
  mkdirSync(join(courseDir, 'attachments'), { recursive: true })
  writeFileSync(lessonPath, projection.markdown, 'utf8')
  for (const attachment of attachments) {
    copyFileSync(resolveLibraryPath(libraryRoot, refToFile.get(attachment.ref)!), join(courseDir, 'attachments', attachment.name))
  }
  db.prepare(
    `INSERT INTO obsidian_exports (lesson_id, vault_path, file_path, exported_version, exported_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lesson_id) DO UPDATE SET vault_path=excluded.vault_path, file_path=excluded.file_path,
       exported_version=excluded.exported_version, exported_at=excluded.exported_at`
  ).run(lessonId, vault, lessonPath, row.version, new Date().toISOString())
  return { path: lessonPath, version: row.version }
}

/** 批2: rebuild the course's _概念.md from every lesson's latest concepts. */
export function rebuildCourseConceptIndex(db: Db, courseId: string, vault: string): void {
  const course = db.prepare('SELECT name FROM courses WHERE id = ?').get(courseId) as { name: string } | undefined
  if (course == null) throw new Error('课程不存在')
  const lessons = latestCourseNotes(db, courseId).map((row) => {
    const note = parseNote(row.note_json)
    return { lesson: row.lessonTitle, concepts: note.concepts.map((c) => ({ term: c.term, definition: c.definition })) }
  })
  const courseDir = join(vault, OBSIDIAN_ROOT_DIR, safeFileName(course.name))
  mkdirSync(courseDir, { recursive: true })
  writeFileSync(join(courseDir, '_概念.md'), projectConceptIndex(course.name, lessons), 'utf8')
}

/** 批2: rebuild the vault-wide _index.md from the export manifest. */
export function rebuildVaultIndex(db: Db, vault: string): void {
  const rows = db
    .prepare(
      `SELECT c.name AS courseName, COUNT(*) AS lessons
       FROM obsidian_exports e
       JOIN lessons l ON l.id = e.lesson_id
       JOIN courses c ON c.id = l.course_id
       WHERE e.vault_path = ?
       GROUP BY c.id ORDER BY c.name`
    )
    .all(vault) as Array<{ courseName: string; lessons: number }>
  const root = join(vault, OBSIDIAN_ROOT_DIR)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, '_index.md'), projectVaultIndex(rows.map((r) => ({ course: r.courseName, lessons: r.lessons }))), 'utf8')
}

/** 批2: whole-course export — every lesson with a note, then derived pages.
 *  批3 (P23): 写失败的篇目**带原因返回**（此前 catch 是空的，「跳过 N 篇」是唯一
 *  线索——vault 落在 OneDrive/只读位置时 N 篇全是这么静默丢掉的）。 */
export function exportCourseToObsidian(
  db: Db,
  libraryRoot: string,
  courseId: string,
  vault: string
): { exported: number; skipped: number; failures: ObsidianExportFailure[] } {
  const lessons = db.prepare('SELECT id FROM lessons WHERE course_id = ?').all(courseId) as Array<{ id: string }>
  let exported = 0
  let skipped = 0
  const failures: ObsidianExportFailure[] = []
  for (const lesson of lessons) {
    try {
      exportLessonToObsidian(db, libraryRoot, lesson.id, vault)
      exported += 1
    } catch (error) {
      // 诚实跳过：无笔记课时计入 skipped，不中断整课导出。
      skipped += 1
      if (!(error instanceof LessonHasNoNoteError)) failures.push({ lessonId: lesson.id, reason: failureReason(error) })
    }
  }
  if (exported > 0) {
    rebuildCourseConceptIndex(db, courseId, vault)
    rebuildVaultIndex(db, vault)
  }
  return { exported, skipped, failures }
}
