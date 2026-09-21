import { describe, expect, it } from 'vitest'
import { ZOOM_CAP, zoomFactorForWidth } from '../src/main/window-zoom'

describe('window-zoom（P28, plan 2026-09-21）', () => {
  it('公式把 CSS 视口钉在基准 1600：zoom = W/1600', () => {
    expect(zoomFactorForWidth(1600)).toBe(1)
    expect(zoomFactorForWidth(3200)).toBe(2)
    expect(zoomFactorForWidth(1920)).toBeCloseTo(1.2, 6)
    expect(zoomFactorForWidth(2560)).toBeCloseTo(1.6, 6)
  })

  it('窗口窄于基准不缩小（小窗口保持设计原样）', () => {
    expect(zoomFactorForWidth(1266)).toBe(1)
    expect(zoomFactorForWidth(960)).toBe(1) // minWidth 处也不缩
  })

  it(`cap ${ZOOM_CAP}：4K 与超宽屏封顶`, () => {
    expect(zoomFactorForWidth(3840)).toBeCloseTo(2.4, 6)
    expect(zoomFactorForWidth(4000)).toBe(ZOOM_CAP)
    expect(zoomFactorForWidth(100000)).toBe(ZOOM_CAP)
  })

  it('非正/非有限输入按 1 处理（resize 事件不得放大出 NaN）', () => {
    expect(zoomFactorForWidth(0)).toBe(1)
    expect(zoomFactorForWidth(-100)).toBe(1)
    expect(zoomFactorForWidth(Number.NaN)).toBe(1)
    expect(zoomFactorForWidth(Number.POSITIVE_INFINITY)).toBe(1)
  })
})
