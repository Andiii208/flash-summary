/**
 * Migration 003: provider settings tables.
 * providers: one row per configured provider (api_key DPAPI-sealed).
 * capability_bindings: asr | multimodal | text → provider + model.
 */
export const migration003 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE capability_bindings (
        capability TEXT PRIMARY KEY CHECK (capability IN ('asr', 'multimodal', 'text')),
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model TEXT NOT NULL
      );
    `)
  }
}
