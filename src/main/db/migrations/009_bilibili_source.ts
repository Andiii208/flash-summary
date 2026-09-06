/**
 * Migration 009: second video source — Bilibili (plan 2026-09-06-bilibili-source-integration).
 *
 * courses.source / lessons.source — 'seu' (default, existing rows) or
 * 'bilibili'. The orchestrator branches on lessons.source; the sidebar
 * badges on courses.source. No CHECK constraint on purpose: adding a third
 * source later must not require a table rebuild.
 *
 * Bilibili identifiers: courses.bili_bvid (BV id, one course per video),
 * courses.bili_up_mid (uploader), lessons.bili_cid (per-P content id),
 * lessons.bili_page (1-based P number — the sidebar sort key). Nullable
 * everywhere: SEU rows keep NULL. Partial unique indexes keep the same
 * video (and the same cid) from being imported twice without affecting
 * SEU rows (NULL never collides).
 */
export const migration009 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      ALTER TABLE courses ADD COLUMN source TEXT NOT NULL DEFAULT 'seu';
      ALTER TABLE courses ADD COLUMN bili_bvid TEXT;
      ALTER TABLE courses ADD COLUMN bili_up_mid TEXT;
      ALTER TABLE lessons ADD COLUMN source TEXT NOT NULL DEFAULT 'seu';
      ALTER TABLE lessons ADD COLUMN bili_cid TEXT;
      ALTER TABLE lessons ADD COLUMN bili_page INTEGER;
      CREATE UNIQUE INDEX idx_courses_bili_bvid ON courses(bili_bvid) WHERE bili_bvid IS NOT NULL;
      CREATE UNIQUE INDEX idx_lessons_bili_cid ON lessons(bili_cid) WHERE bili_cid IS NOT NULL;
    `)
  }
}
