/**
 * Migration 013: 删掉 `capability_bindings` 里遗留的 `text` 绑定（P25，plan
 * 2026-09-20-ux-issues-remediation.md 补批，决策 D13）。
 *
 * 起因：能力面收敛为两项（ASR / 多模态），`text` 不再是能力——追问走多模态绑定
 * （spec §4 批注）。老库里那一行留着只会在 Provider 列表渲染一个 UI 再也无法维护
 * 的徽标（`ProviderRowView` 按库里的 bindings 渲染），属「声明与实现漂移」；
 * 删掉后追问自然落到多模态绑定，用户不需要做任何事。
 *
 * 只删这一种行：不动 migration 003 的 CHECK 约束（改它要重建表，收益为零），
 * 也不碰其它绑定。
 */
export const migration013 = {
  up(db: { exec: (sql: string) => void }): void {
    db.exec(`DELETE FROM capability_bindings WHERE capability = 'text';`)
  }
}
