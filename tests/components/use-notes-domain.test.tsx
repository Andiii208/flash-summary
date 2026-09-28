import { describe, expect, it, vi, afterEach } from 'vitest'
import { waitForImages } from '../../src/renderer/hooks/use-notes-domain'

/**
 * 批5 (plan 2026-09-28 H10): PDF 导出可永久卡死。
 *
 * 病因：waitForImages 等每张 <img> 的 load/error——一个既不 resolve 也不 error 的
 * src（极少见但存在：挂起的 data channel、损坏的响应不带错误码）会让 Promise 永不
 * settle，于是 pdfBusy 永真、PDF 按钮永远「生成 PDF 中…」+disabled，用户只能重启
 * 应用。修法：Promise.race 兜 8s 超时继续打印（缺图打印出来是空白占位，比把按钮
 * 锁死好）。
 */
describe('waitForImages (批5 H10: 超时兜底)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('永不 settle 的 img 也能在超时后继续（按钮不会永久禁用）', async () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const stuck = document.createElement('img')
    // complete=false 且谁也不触发 load/error——旧实现下这个 Promise 永不 settle
    Object.defineProperty(stuck, 'complete', { value: false, configurable: true })
    root.appendChild(stuck)
    let settled = false
    void waitForImages(root).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(7999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })

  it('能正常 decode 的 img 不等待超时（立刻继续）', async () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const done = document.createElement('img')
    Object.defineProperty(done, 'complete', { value: true, configurable: true })
    root.appendChild(done)
    let settled = false
    void waitForImages(root).then(() => {
      settled = true
    })
    // 一个微任务队列的时间就够——不等 8s
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })

  it('没有图片时立即返回（不必白等超时）', async () => {
    const root = document.createElement('div')
    await expect(waitForImages(root)).resolves.toBeUndefined()
  })
})
