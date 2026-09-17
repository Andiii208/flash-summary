/**
 * 批5 (plan 2026-09-17 item 3) 单测：SVG → PNG 光栅化的**纯逻辑**部分。
 *
 * canvas 只能在真实浏览器里跑，所以光栅化把 DOM 依赖收进两个钩子（`RasterHooks`），
 * 尺寸换算、铺底、前缀剥离这些能出错的地方就在 node 环境下直测——不让「只有浏览器
 * 能跑」变成验证盲区。真实的 canvas 路径由 smoke 与装机走查覆盖。
 */
import { describe, expect, it, vi } from 'vitest'
import { rasterizeSvg, type RasterHooks } from '../src/renderer/rasterize-svg'

/** 记录调用的假 canvas：只实现被测逻辑真正用到的那几个面。 */
function fakeCanvas(dataUrl = 'data:image/png;base64,QUJD') {
  const calls: string[] = []
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => {
      calls.push(`getContext:${kind}`)
      return {
        fillStyle: '',
        fillRect: (x: number, y: number, w: number, h: number) => calls.push(`fillRect:${x},${y},${w},${h}`),
        drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => calls.push(`drawImage:${x},${y},${w},${h}`)
      }
    },
    toDataURL: (kind: string) => {
      calls.push(`toDataURL:${kind}`)
      return dataUrl
    }
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, calls, raw: canvas }
}

function hooksFor(canvas: HTMLCanvasElement): RasterHooks {
  return {
    createCanvas: () => canvas,
    loadImage: vi.fn(async () => ({}) as unknown as CanvasImageSource)
  }
}

describe('rasterizeSvg 光栅化', () => {
  it('默认 2× —— 输出像素尺寸是布局尺寸的两倍（贴图不发虚）', async () => {
    const { canvas } = fakeCanvas()
    const result = await rasterizeSvg('<svg/>', 400, 250, 2, hooksFor(canvas))
    expect(result.width).toBe(800)
    expect(result.height).toBe(500)
  })

  it('缩放系数可覆盖；非法/零缩放退回 1×（不产生 0 尺寸画布）', async () => {
    const three = fakeCanvas()
    expect((await rasterizeSvg('<svg/>', 100, 100, 3, hooksFor(three.canvas))).width).toBe(300)
    const zero = fakeCanvas()
    expect((await rasterizeSvg('<svg/>', 100, 100, 0, hooksFor(zero.canvas))).width).toBe(100)
    const negative = fakeCanvas()
    expect((await rasterizeSvg('<svg/>', 100, 100, -5, hooksFor(negative.canvas))).width).toBe(100)
  })

  it('先铺纸白底再画图 —— 透明底贴到深色界面里会糊', async () => {
    const { canvas, calls, raw } = fakeCanvas()
    await rasterizeSvg('<svg/>', 10, 10, 1, hooksFor(canvas))
    expect(raw.getContext('2d')).toBeTruthy()
    // fillRect 先于 drawImage
    expect(calls.indexOf('fillRect:0,0,10,10')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('fillRect:0,0,10,10')).toBeLessThan(calls.findIndex((c) => c.startsWith('drawImage')))
    expect(calls).toContain('toDataURL:image/png')
  })

  it('剥掉 data URL 前缀 —— main 侧要的是裸 base64', async () => {
    const { canvas } = fakeCanvas('data:image/png;base64,QUJD')
    expect((await rasterizeSvg('<svg/>', 10, 10, 1, hooksFor(canvas))).base64).toBe('QUJD')
  })

  it('已经是不带前缀的串也照原样返回（不重复剥）', async () => {
    const { canvas } = fakeCanvas('QUJD')
    expect((await rasterizeSvg('<svg/>', 10, 10, 1, hooksFor(canvas))).base64).toBe('QUJD')
  })

  it('尺寸为空 → 明确报错，不做无意义的光栅化', async () => {
    const { canvas } = fakeCanvas()
    await expect(rasterizeSvg('<svg/>', 0, 100, 2, hooksFor(canvas))).rejects.toThrow('尺寸为空')
    await expect(rasterizeSvg('<svg/>', 100, 0, 2, hooksFor(canvas))).rejects.toThrow('尺寸为空')
  })

  it('拿不到 2d 上下文 → 明确报错（不静默产出一张空图）', async () => {
    const canvas = { width: 0, height: 0, getContext: () => null, toDataURL: () => '' } as unknown as HTMLCanvasElement
    await expect(rasterizeSvg('<svg/>', 10, 10, 1, hooksFor(canvas))).rejects.toThrow('canvas 2d')
  })

  it('图片加载失败 → 把钩子的错误原样抛出（不吞）', async () => {
    const { canvas } = fakeCanvas()
    const hooks: RasterHooks = {
      createCanvas: () => canvas,
      loadImage: async () => {
        throw new Error('SVG 光栅化失败：图片无法加载')
      }
    }
    await expect(rasterizeSvg('<svg/>', 10, 10, 1, hooks)).rejects.toThrow('图片无法加载')
  })

  it('把 SVG 原文交给图片钩子（渲染层据此产 data URL）', async () => {
    const { canvas } = fakeCanvas()
    const loadImage = vi.fn(async () => ({}) as unknown as CanvasImageSource)
    await rasterizeSvg('<svg>甲</svg>', 10, 10, 1, { createCanvas: () => canvas, loadImage })
    expect(loadImage).toHaveBeenCalledWith('<svg>甲</svg>')
  })
})
