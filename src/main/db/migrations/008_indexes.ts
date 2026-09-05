/**
 * Migration 008 (review F5, 2026-09-05): growth indexes.
 * tasks/qa list queries sort by created_at (full scans as history grows),
 * and the spec §6 course-level Q&A reserve needs a course_id index to be
 * anything more than a comment.
 */
export const migration008 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_qa_created ON qa(created_at);
      CREATE INDEX IF NOT EXISTS idx_qa_course ON qa(course_id);
    `)
  }
}
