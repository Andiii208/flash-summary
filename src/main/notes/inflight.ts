/**
 * 批5 (plan 2026-09-19 audit remediation): 同课时笔记写在途登记。
 *
 * polish 与 regenerate 走同一条「读最新版 → 模型重写 → saveNoteVersion
 * (MAX+1)」的路径。此前只有 polish 有进程内 in-flight 标记，regenerate
 * 毫无守卫：两路同时打同一课时时，MAX(version) 会算出同一个版本号，
 * INSERT 撞 UNIQUE(id) —— 用户看到一句原始 SQL 错误，笔记停在上一个
 * 版本。这个模块级 Map 让同一课时同时只允许一路（polish × regenerate
 * 互斥），claim 返回 false 即拒绝。
 *
 * 批2 (plan 2026-09-20, P2): repair（定向补全）走的是**同一条**写路径
 * （读最新版 → 返修 → 采纳才 saveNoteVersion），所以共用这本登记——
 * 三个 kind 两两互斥。
 */

export type NoteInflightKind = 'polish' | 'regenerate' | 'repair'

const inflight = new Map<string, NoteInflightKind>()

/** Claim the lesson; false when the other flow already holds it. */
export function claimNoteInflight(lessonId: string, kind: NoteInflightKind): boolean {
  if (inflight.has(lessonId)) return false
  inflight.set(lessonId, kind)
  return true
}

/** Release the claim (must run in a finally so a throw cannot wedge the lesson). */
export function releaseNoteInflight(lessonId: string): void {
  inflight.delete(lessonId)
}
