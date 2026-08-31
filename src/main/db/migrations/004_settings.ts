/**
 * Migration 004: user settings key-value store (U3).
 * Keys: libraryRoot, cacheDir, theme. Values are plain strings;
 * paths are resolved/validated by the main process, never the renderer.
 */
export const migration004 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }
}
