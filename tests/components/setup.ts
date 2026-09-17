/**
 * 组件测试环境补齐（批4, plan 2026-09-17 note-quality upgrade）。
 *
 * happy-dom **不实现** `document.compatMode`（读出来是 undefined），而 KaTeX 在
 * *模块加载时* 会做 `document.compatMode !== 'CSS1Compat'` 的判定，不满足就把
 * render 换成永久抛错的桩——症状是「KaTeX doesn't work in quirks mode」，
 * 但根因是测试环境缺这个属性，不是产品问题：
 * `src/renderer/index.html` 第一行就是 `<!doctype html>`，真实 Electron 渲染进程
 * 处于标准模式，compatMode 本来就是 CSS1Compat。
 *
 * 必须跑在被测模块 import 之前（KaTeX 的判定是模块级副作用），所以放在
 * setupFiles 而不是测试文件里。
 */
if (typeof document !== 'undefined' && document.compatMode !== 'CSS1Compat') {
  Object.defineProperty(document, 'compatMode', { configurable: true, get: () => 'CSS1Compat' })
}

export {}
