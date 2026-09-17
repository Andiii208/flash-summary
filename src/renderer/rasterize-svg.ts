/**
 * SVG → PNG 光栅化（批5, plan 2026-09-17 note-quality-upgrade item 3）。
 *
 * 为什么在渲染层做：canvas 只有渲染进程有，而**导图 SVG 是纯文本**——渲染层可以
 * 直接调 `treeToSvgDocument` 自己产 SVG 再画进 canvas，于是
 *   ① SVG 文本不必经 IPC 往返（省一趟大字符串）
 *   ② 主进程不需要任何图像编码器（零新依赖）
 *   ③ main 只负责把 base64 解码、校验魔数、落盘（见 `notes:exportPng`）
 *
 * 为什么不会污染画布：导出的 SVG 只含 text/rect/path 与内联色值，**没有任何外部
 * 引用**（无外链图片、无外链字体），所以 data: URL 光栅化后 `toDataURL` 不会把
 * 画布打上 tainted 标记。
 *
 * 缩放默认 2×：矢量导图在 1× 下贴进聊天/文档会发虚，2× 兼顾清晰与体积。
 */

/** 光栅化结果：base64（**不含** `data:` 前缀）+ 实际像素尺寸。 */
export interface RasterResult {
  base64: string
  width: number
  height: number
}

/**
 * 测试缝：DOM 依赖集中在这两个钩子里，纯逻辑（尺寸换算、铺底、前缀剥离）就能在
 * node 环境下直测——canvas 只能在真实浏览器里跑，不该因此成为验证的盲区。
 */
export interface RasterHooks {
  createCanvas: (width: number, height: number) => HTMLCanvasElement
  /** 载入 SVG 并返回可绘制对象（真实实现是一个已 decode 的 HTMLImageElement）。 */
  loadImage: (svg: string) => Promise<CanvasImageSource>
}

/** `toDataURL` 会带上的前缀，落盘前必须剥掉。 */
const DATA_URL_PREFIX = 'data:image/png;base64,'

/** 纸白底：导图本身是纸白配色（SKILL §6），但透明底贴到深色界面里会糊。 */
const PAPER_WHITE = '#ffffff'

/** 默认钩子：真实 DOM。只在渲染进程里被调用。 */
function domHooks(): RasterHooks {
  return {
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return canvas
    },
    loadImage: (svg) =>
      new Promise<CanvasImageSource>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('SVG 光栅化失败：图片无法加载'))
        // data: URL + encodeURIComponent 是 SVG 内联的标准做法（不必再编码一层 base64）。
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      })
  }
}

export async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
  scale: number,
  hooks: RasterHooks
): Promise<RasterResult> {
  if (width <= 0 || height <= 0) throw new Error('导图尺寸为空，无法导出')
  const factor = scale > 0 ? scale : 1
  const pixelWidth = Math.max(1, Math.round(width * factor))
  const pixelHeight = Math.max(1, Math.round(height * factor))
  const canvas = hooks.createCanvas(pixelWidth, pixelHeight)
  const image = await hooks.loadImage(svg)
  const context = canvas.getContext('2d')
  if (context == null) throw new Error('导图导出失败：当前环境不支持 canvas 2d')
  context.fillStyle = PAPER_WHITE
  context.fillRect(0, 0, pixelWidth, pixelHeight)
  context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
  const dataUrl = canvas.toDataURL('image/png')
  return {
    base64: dataUrl.startsWith(DATA_URL_PREFIX) ? dataUrl.slice(DATA_URL_PREFIX.length) : dataUrl,
    width: pixelWidth,
    height: pixelHeight
  }
}

/** 便捷入口：渲染进程里直接用（真实 DOM，2× 光栅化）。 */
export function svgToPngBase64(svg: string, width: number, height: number, scale = 2): Promise<RasterResult> {
  return rasterizeSvg(svg, width, height, scale, domHooks())
}
