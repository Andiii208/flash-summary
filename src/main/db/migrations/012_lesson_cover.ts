/**
 * Migration 012: 课时封面图（批 A2, plan 2026-09-19-note-experience-overhaul）。
 *
 * 起因：B 站导入时封面 pic 早已解析并下载（parse.ts:64 / ipc.ts:362），却只用于
 * 导入对话框的预览缩略图后即丢弃——笔记第一屏永远从纯文字开始。本列把封面变成
 * 库内资产（attachments/<lessonId>/cover.jpg，与关键帧/PPT 同一路径规约）。
 *
 * 可空、无默认值：没有封面的课时（SEU 源、导入失败的）就是 NULL，渲染端用
 * 第一张关键帧兜底。零迁移成本。
 */
export const migration012 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`ALTER TABLE lessons ADD COLUMN cover_path TEXT;`)
  }
}
