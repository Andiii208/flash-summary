/**
 * Migration 007: course metadata for «my courses» and official-site parity
 * (usability overhaul C1/C3, 2026-09-03).
 *
 * courses.subj_code — the platform's subject code; courses of the same
 *   subject across different teachers share it, which drives the
 *   «同课程其他老师» recommendation.
 * courses.classroom / courses.cour_times — the live t-1 record's
 *   clroName (教室) and courTimes (讲次) so the course tree shows the same
 *   time/place info the official site shows.
 * courses.is_mine — user pin (0/1). The schedule-API probe may later set
 *   this automatically; until then the user pins their own courses.
 */
export const migration007 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      ALTER TABLE courses ADD COLUMN subj_code TEXT;
      ALTER TABLE courses ADD COLUMN classroom TEXT;
      ALTER TABLE courses ADD COLUMN cour_times TEXT;
      ALTER TABLE courses ADD COLUMN is_mine INTEGER NOT NULL DEFAULT 0 CHECK (is_mine IN (0, 1));
    `)
  }
}
