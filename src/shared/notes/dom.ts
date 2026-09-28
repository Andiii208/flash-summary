/**
 * DOM 相关的共享小工具（批5, plan 2026-09-28 H12）。
 *
 * 为什么在 shared 里：概念名/术语是**模型文本**，会被拼进
 * `document.querySelector` 的属性选择器做锚点跳转。含 `"` 或 `\` 时选择器语法
 * 直接 SyntaxError，sticky 目录滚动高亮与概念卡跳转**静默失效**——而 44 行前
 * 就有一处写好的转义逻辑没用上（NoteViewer 曾有两份拼法）。判据只能有一份，
 * 所以抽到这里，渲染层两处都复用。
 */

/**
 * 把值转义成可安全放进双引号属性选择器 `[attr="..."]` 的形式。
 * CSS 字符串里反斜杠与双引号需转义；其余字符在引号内原样生效。
 */
export function escapeSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
