import { describe, expect, it } from 'vitest'
import { tabForHotkey } from '../../src/renderer/App'

describe('tab hotkeys (批F Ctrl+1..3)', () => {
  // P36 (plan 2026-09-21): 追问 tab 已移除（右坞常驻）——Ctrl+3 从追问顺移为设置。
  it('maps Ctrl+1..3 to the three tabs in order', () => {
    expect(tabForHotkey('1', { ctrl: true, alt: false, meta: false, shift: false })).toBe('tasks')
    expect(tabForHotkey('2', { ctrl: true, alt: false, meta: false, shift: false })).toBe('notes')
    expect(tabForHotkey('3', { ctrl: true, alt: false, meta: false, shift: false })).toBe('settings')
  })

  it('ignores non-digit keys and out-of-range digits', () => {
    expect(tabForHotkey('a', { ctrl: true, alt: false, meta: false, shift: false })).toBeNull()
    expect(tabForHotkey('4', { ctrl: true, alt: false, meta: false, shift: false })).toBeNull()
    expect(tabForHotkey('5', { ctrl: true, alt: false, meta: false, shift: false })).toBeNull()
    expect(tabForHotkey('0', { ctrl: true, alt: false, meta: false, shift: false })).toBeNull()
  })

  it('requires Ctrl alone — shifted/alt/meta chords and bare keys do nothing', () => {
    expect(tabForHotkey('1', { ctrl: false, alt: false, meta: false, shift: false })).toBeNull()
    expect(tabForHotkey('1', { ctrl: true, alt: true, meta: false, shift: false })).toBeNull()
    expect(tabForHotkey('1', { ctrl: true, alt: false, meta: true, shift: false })).toBeNull()
    expect(tabForHotkey('1', { ctrl: true, alt: false, meta: false, shift: true })).toBeNull()
  })
})
