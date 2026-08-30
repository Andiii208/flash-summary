/**
 * Migration 001: initial schema.
 *
 * Tables: courses, lessons, tasks, transcripts, ppt_pages, keyframes,
 * notes (with version history), qa (lesson-level; course_id reserved for
 * future course-level Q&A without a storage redesign).
 */
export const migration001 = {
  up(db: { exec: (sql: string) => void }): void {
  db.exec(`
    CREATE TABLE courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      term TEXT,
      teacher TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      started_at TEXT,
      duration_seconds INTEGER,
      stream_urls_json TEXT,
      ppt_course_id TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE INDEX idx_lessons_course ON lessons(course_id);

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK (state IN (
        'pending', 'fetching_course', 'downloading_video', 'extracting_audio',
        'transcribing', 'extracting_visuals', 'summarizing', 'succeeded', 'failed'
      )),
      failed_stage TEXT CHECK (failed_stage IS NULL OR failed_stage IN (
        'fetching_course', 'downloading_video', 'extracting_audio',
        'transcribing', 'extracting_visuals', 'summarizing'
      )),
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_tasks_lesson ON tasks(lesson_id);

    CREATE TABLE transcripts (
      lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
      segments_json TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE ppt_pages (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      page_index INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (lesson_id, page_index)
    );

    CREATE INDEX idx_ppt_lesson ON ppt_pages(lesson_id);

    CREATE TABLE keyframes (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      timestamp_seconds REAL NOT NULL,
      file_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_keyframes_lesson ON keyframes(lesson_id);

    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      note_json TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (lesson_id, version)
    );

    CREATE INDEX idx_notes_lesson ON notes(lesson_id);

    CREATE TABLE qa (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      course_id TEXT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_qa_lesson ON qa(lesson_id);
  `)
  }
}
