import { describe, expect, it } from 'vitest'
import { escapeSelectorValue } from '../../src/shared/notes/dom'

// 批5 (plan 2026-09-28 H12): 概念名是模型文本，会被拼进属性选择器
// （NoteViewer 的概念卡跳转与 sticky 目录高亮两处）。含引号或反斜杠时选择器
// 语法直接 SyntaxError、静默失效——转义判据唯一一份，钉在这里。
describe('escapeSelectorValue', () => {
  it('escapes backslashes and double quotes for attribute selectors', () => {
    expect(escapeSelectorValue('大O')).toBe('大O')
    expect(escapeSelectorValue('大"O')).toBe('大\\"O')
    expect(escapeSelectorValue('a\\b')).toBe('a\\\\b')
    expect(escapeSelectorValue('"\\"')).toBe('\\"\\\\\\"')
  })

  it('未转义形态（旧代码的产物）会抛 SyntaxError', () => {
    const term = '大"O'
    // happy-dom 与 Chromium 一样：引号把属性选择器的字符串截断 → 语法错误。
    // 这条就是 H12 的回归信号——修复前传进去的正是这个形态。
    expect(() => document.querySelector(`[data-concept-term="${term}"]`)).toThrow()
  })
})

// 说明：转义形态的**执行**断言不在 node 层做——happy-dom 的选择器引擎不实现 CSS
// 字符串转义（`\"` 抛、`\\` 命中不了），而 Chromium 实现（产品跑在 Electron 里，
// 那才是真实执行环境）。转义形态由 NoteViewer 的 spy 断言钉住：「传进
// querySelector 的必须是转义后的字符串」。
