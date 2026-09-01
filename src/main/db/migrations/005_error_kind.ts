/**
 * Migration 005: task error diagnostics (U4).
 * error_kind records the failure taxonomy (session_expired / cancelled /
 * provider kind) so the settings page can show actionable error logs.
 */
export const migration005 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec('ALTER TABLE tasks ADD COLUMN error_kind TEXT')
  }
}
