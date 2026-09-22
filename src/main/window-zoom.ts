/**
 * P28 (plan 2026-09-21): 窗口级界面缩放——按主窗物理宽度设 webContents zoomFactor。
 *
 * 用户要的是「窗口放大占全屏时直接等比例放大，保持视觉统一」（2026-09-20 方案
 * D12 的备选 A，本轮 Andiii 明确选它）。CSS 视口 = 物理宽 / zoom，所以档位公式
 * 同时就是「CSS 视口的锚」：
 *
 * - 基准 1600：宽屏下 CSS 视口恒为 1600——阅读列/弹层/列表的既定布局逐像素复用
 *   1600 宽窗口的形态（视觉统一性的最大化），≤1024 窄窗档永不误触（视口恒
 *   ≥1600 > 1024）。追问坞不靠断点：2026-09-22 批2 起重写为各宽下均悬浮的
 *   右侧 fixed 小卡片（style.css .qa-dock），随视口逐像素等比例放大。
 * - 下限 1：窗口窄于基准时保持设计原样，不把界面缩小。
 * - 上限 ZOOM_CAP：超宽屏（4K 以上）封顶，否则侧栏/字号会大到失真。
 * - 连续公式（无步进）：0.25 步进版在 1920 窗会留下约 492px 物理空白（方案
 *   §1.3 测算表）；调用侧按「|Δz|>0.02 才应用」把拖拽期重排降到约每 32px 一次。
 *
 * 纯函数、零依赖——挂点与节流在 src/main/index.ts，PDF 打印的临时复位在
 * src/main/notes/pdf-export.ts。
 *
 * ⚠️ 2026-09-22（plan 2026-09-22-wide-screen-blank-space）两条订正，后来者据此
 * 推理前先读：
 * ① **width 口径 = 物理像素**（`.tmp-zoom-check` 实验锁定：PowerShell
 *    SetWindowPos 设物理宽 1500 → innerWidth 1486、zoom=1；若 getContentBounds
 *    返回 DIP，同设置下视口会是 2250）。DPR 1.5 屏上 zoom=1 时 1 CSS px = 1
 *    物理 px，字号物理值 = 15z——DPI 缩放不额外介入。
 * ② **ZOOM_CAP 触顶后视口不再钉 1600**：W > 4000 物理时 z=2.5 封顶，视口 =
 *    W/2.5 > 1600，布局会第一次「看见」>1600 的视口——而它按 ≤1600 设计，
 *    右侧空白 =（视口−968）× 2.5 物理 px（双屏横拼拖窗会看到「越拖越空」）。
 *    P28 钉子注释「宽屏档永不可命中」在 cap 之上是**假命题**；本机 2560 触不到，
 *    但修复（让 cap 之上也钉视口，即改公式）属产品边界决策，未擅自改——
 *    plan 2026-09-22-wide-screen-blank-space D10 记录在案。
 * ③ 只监听 'resize'：换显示器/改系统缩放/RDP 后 zoom 不重算（跨屏拖动会漂移）。
 *    加 'display-metric-changed' 监听是纯增益小修，列入该 plan D10 走查项。
 */

/** CSS 视口的锚：窗口达到该宽度时缩放为 1，更宽按比例放大。 */
export const ZOOM_BASIS_WIDTH = 1600

/** 缩放上限（4K 3840 → 2.4，超宽屏封此处）。 */
export const ZOOM_CAP = 2.5

/** 应用侧的最小变化量：小于此值不调 setZoomFactor（拖拽期防重排抖动）。 */
export const ZOOM_EPSILON = 0.02

export function zoomFactorForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1
  return Math.min(ZOOM_CAP, Math.max(1, width / ZOOM_BASIS_WIDTH))
}
