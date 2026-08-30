/**
 * Migration 002: task stage output evidence.
 * Stores per-stage artifact evidence (paths, byte counts, frame counts) so
 * retries can verify which stages already produced outputs (spec §7).
 */
export const migration002 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      CREATE TABLE task_stage_outputs (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        output_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (task_id, stage)
      );
    `)
  }
}
