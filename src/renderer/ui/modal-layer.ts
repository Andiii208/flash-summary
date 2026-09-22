/**
 * 模态层的「谁在最上面」判定（批1, plan 2026-09-20 P13 验收项「Esc 只关一层」）。
 *
 * 四个自绘弹层（course-browser / my-study / course-map / bili-dialog）与共享
 * `ui/Dialog` 此前各自往 window 上挂 Esc 监听——两层同时开着时一次 Esc 把两层
 * 一起关掉，而验收项要的是「只关一层」。层级判据不引入新的状态：
 *   - `.dialog-backdrop` 是 z-index 60 那一档（style.css），恒在自绘 overlay（40）之上；
 *   - 同一档内由 DOM 顺序决定谁在上面（四个自绘 overlay 同为 40，后者居上）。
 * 于是「最上层」= 有 `.dialog-backdrop` 时取最后一个，否则取最后一个自绘 overlay。
 *
 * 选择器与 style.css 顶部基元块的成员表一致（基元是**组选择器**，四个成员各自
 * 挂自己的类名，元素上没有 `fullscreen-overlay` 这个类）。
 *
 * 组件把**自己卡片**的元素传进来（卡片是 overlay 的孩子），函数沿 `closest` 找到
 * 自己的层根再比对——卸载过的旧实例其元素已脱离文档，天然不再是最上层（这同时
 * 治掉了 tests/helpers/preact.ts 不清 unmount 带来的「旧实例也响应 Esc」噪声）。
 */
const OVERLAY_SELECTOR = '.fullscreen-overlay, .course-browser-overlay, .course-map-overlay, .bili-dialog-overlay, .mindmap-full-overlay'
const MODAL_ROOT_SELECTOR = `.dialog-backdrop, ${OVERLAY_SELECTOR}`

/** 只有最上层的模态层该响应 Esc（被压在下面的层不响应）。 */
export function isTopmostModalLayer(el: Element | null | undefined): boolean {
  const root = el?.closest(MODAL_ROOT_SELECTOR) ?? null
  if (root == null) return false
  const backdrops = document.querySelectorAll('.dialog-backdrop')
  const pool: NodeListOf<Element> = backdrops.length > 0 ? backdrops : document.querySelectorAll(OVERLAY_SELECTOR)
  return pool[pool.length - 1] === root
}
