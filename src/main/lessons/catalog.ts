/**
 * 课时目录（lessons 行）的共用写入口。
 *
 * 2026-09-21（UX 整改批1 评审补口）：D1 的「带产物的行不被收割覆盖」最初只落在
 * `school:harvestLessons` 一个 writer 上，但同一份平台课时目录在任务侧还有第二个
 * writer——`fetching_course` 的 catalog refresh（orchestrator，SEU 路径每次任务都
 * 跑）。两条路径语义必须一致，否则收割刚冻结完、下一次任务运行就把整门课的行名与
 * play_ref 按平台当前索引重写回去：play_ref 正是 play 页用来点「第N节课」的 ref
 * （`selectLessonRef`），被漂移覆盖后下一次任务会去抓另一节课的流并写回这一行。
 * 「有产物 = 冻结」的判定与写法现在只有这一份，两个调用方都走它。
 */
import type { Db } from '../db/open'

/** 一次收割到的课时条目（play 页 DOM 的 index/title/ref）。 */
export interface HarvestedLessonEntry {
  index: number
  title: string
  ref: string
}

/** 受保护行：id + 冻结前（也就是保持不动）的 title/play_ref。 */
export interface ProtectedLessonRow {
  id: string
  title: string
  play_ref: string | null
}

/** 平台列表与受保护行不一致、但被冻结没写下去的条目。 */
export interface CatalogDrift {
  lessonId: string
  fromTitle: string
  fromRef: string | null
  toTitle: string
  toRef: string
}

export interface CatalogUpsertResult {
  /** 该课程里「有产物」的行——调用方据此把它们排除在 DELETE 之外。 */
  protectedRows: ProtectedLessonRow[]
  /** 被冻结的漂移条目（调用方决定怎么落日志）。 */
  drifted: CatalogDrift[]
}

/**
 * 有产物 = notes/transcripts/keyframes/ppt_pages/tasks/qa 任一有行。
 * 六张表与 `001_initial.ts` 的 ON DELETE CASCADE 清单一一对应：凡是删掉课时会
 * 连带毁掉的东西，都算「用户已经投入过」。
 */
export function protectedLessons(db: Db, courseId: string): ProtectedLessonRow[] {
  return db
    .prepare(
      `SELECT l.id AS id, l.title AS title, l.play_ref AS play_ref FROM lessons l
       WHERE l.course_id = ?
         AND (EXISTS(SELECT 1 FROM notes n WHERE n.lesson_id = l.id)
           OR EXISTS(SELECT 1 FROM transcripts t WHERE t.lesson_id = l.id)
           OR EXISTS(SELECT 1 FROM keyframes k WHERE k.lesson_id = l.id)
           OR EXISTS(SELECT 1 FROM ppt_pages p WHERE p.lesson_id = l.id)
           OR EXISTS(SELECT 1 FROM tasks tk WHERE tk.lesson_id = l.id)
           OR EXISTS(SELECT 1 FROM qa q WHERE q.lesson_id = l.id))`
    )
    .all(courseId) as ProtectedLessonRow[]
}

/**
 * 把一次收割到的目录写进 lessons：
 * - 无产物的行照常 upsert（title/play_ref/fetched_at 跟随平台）；
 * - 有产物的行只补缺（`ON CONFLICT(id) DO NOTHING`）——序号漂移不改行名，play_ref
 *   也不会被指到别的课时。
 * 事务边界由调用方负责（ipc 收割侧在事务里调用）。
 */
export function upsertLessonCatalog(
  db: Db,
  courseId: string,
  entries: ReadonlyArray<HarvestedLessonEntry>,
  fetchedAt: string
): CatalogUpsertResult {
  const protectedRows = protectedLessons(db, courseId)
  const protectedById = new Map(protectedRows.map((row) => [row.id, row]))
  const upsert = db.prepare(
    `INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, play_ref = excluded.play_ref, fetched_at = excluded.fetched_at`
  )
  const insertFrozen = db.prepare(
    `INSERT INTO lessons (id, course_id, title, play_ref, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  )
  const drifted: CatalogDrift[] = []
  for (const entry of entries) {
    const id = `${courseId}-L${entry.index}`
    const existing = protectedById.get(id)
    if (existing == null) {
      upsert.run(id, courseId, entry.title, entry.ref, fetchedAt)
      continue
    }
    if (existing.title !== entry.title || existing.play_ref !== entry.ref) {
      drifted.push({
        lessonId: id,
        fromTitle: existing.title,
        fromRef: existing.play_ref,
        toTitle: entry.title,
        toRef: entry.ref
      })
    }
    insertFrozen.run(id, courseId, entry.title, entry.ref, fetchedAt)
  }
  return { protectedRows, drifted }
}

/** 漂移的单行文案——两个 writer 共用同一形态，日志里好 grep。 */
export function describeCatalogDrift(drift: CatalogDrift): string {
  return `${drift.lessonId} «${drift.fromTitle}»(${drift.fromRef ?? '-'}) → «${drift.toTitle}»(${drift.toRef})`
}
