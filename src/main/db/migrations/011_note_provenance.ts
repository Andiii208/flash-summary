/**
 * Migration 011: 笔记的生成来源版本（批3, plan 2026-09-17 note-quality upgrade）。
 *
 * 起因：存量升级的判定此前只看 `warnCount > 0`，于是一份**由旧 prompt 生成、
 * 但侥幸没有 warn 的笔记永远不会被建议升级**——用户看着「体检：良好」却不知道
 * 它其实是旧工艺的产物。
 *
 * 两列都带默认值 0：0 表示「本列启用之前生成的」，因此**存量笔记天然是「旧版本」**，
 * 这正是升级入口存在的意义，不需要回填。
 */
export const migration011 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`
      ALTER TABLE notes ADD COLUMN prompt_version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE notes ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0;
    `)
  }
}
