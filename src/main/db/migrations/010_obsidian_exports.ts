/**
 * Migration 010: Obsidian export manifest (plan 2026-09-08-obsidian-export).
 *
 * One row per exported lesson — the idempotency key for re-export: the same
 * lesson overwrites its file; a renamed lesson writes the new path and the
 * old file is cleaned up via file_path. vault_path pins WHERE it went so a
 * later vault switch does not delete files in the old vault.
 */
export const migration010 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      CREATE TABLE obsidian_exports (
        lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
        vault_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        exported_version INTEGER NOT NULL,
        exported_at TEXT NOT NULL
      );
    `)
  }
}
