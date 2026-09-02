/**
 * Migration 006: play-page harvest references (v0.2.1 V1).
 *
 * courses.tecl_id / courses.tecl_code — the recording-class identifiers the
 * play-page route needs (`#/play-video?courseId=&teclId=&teclCode=`), taken
 * from the live t-1 course records. lessons.play_ref — the harvested DOM
 * entry (its index among the «第N节课» entries) so fetching_course can
 * select the exact lesson on the play page.
 */
export const migration006 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      ALTER TABLE courses ADD COLUMN tecl_id TEXT;
      ALTER TABLE courses ADD COLUMN tecl_code TEXT;
      ALTER TABLE lessons ADD COLUMN play_ref TEXT;
    `)
  }
}
