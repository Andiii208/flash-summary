import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { saveLessonCover, COVER_FILE_NAME } from '../src/main/notes/cover'
import { attachmentsPath, resolveLibraryPath } from '../src/main/library/paths'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seu-summary-cover-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 1x1 透明 PNG 的 base64（够小、够真，能过大小与解码校验）。 */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('saveLessonCover（批 A2, plan 2026-09-19）', () => {
  it('落盘到 attachments/<lessonId>/cover.jpg 并返回库内相对路径', () => {
    const stored = saveLessonCover(dir, 'bili-BV1xx-P1', PNG_DATA_URL)
    // Windows 上 path.join 产出反斜杠——与关键帧/PPT 的存储规约一致（resolveLibraryPath 两种都吃）。
    expect(stored?.replace(/\\/g, '/')).toBe('attachments/bili-BV1xx-P1/cover.jpg')
    const absolute = resolveLibraryPath(dir, stored as string)
    expect(existsSync(absolute)).toBe(true)
    expect(readFileSync(absolute).subarray(1, 4).toString('latin1')).toBe('PNG')
  })

  it('幂等：同一课时重复落盘覆写同一文件', () => {
    const first = saveLessonCover(dir, 'l1', PNG_DATA_URL)
    const second = saveLessonCover(dir, 'l1', PNG_DATA_URL)
    expect(first).toBe(second)
    expect(existsSync(join(attachmentsPath(dir), 'l1', COVER_FILE_NAME))).toBe(true)
  })

  it('非图片 data URL → null（不抛、不落盘）', () => {
    expect(saveLessonCover(dir, 'l1', 'data:text/plain;base64,aGVsbG8=')).toBeNull()
    expect(saveLessonCover(dir, 'l1', 'https://example.com/pic.jpg')).toBeNull()
    expect(saveLessonCover(dir, 'l1', '')).toBeNull()
    expect(existsSync(join(attachmentsPath(dir), 'l1'))).toBe(false)
  })

  it('空 base64 / 超大 payload → null', () => {
    expect(saveLessonCover(dir, 'l1', 'data:image/png;base64,')).toBeNull()
    const huge = 'data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024)
    expect(saveLessonCover(dir, 'l1', huge)).toBeNull()
  })

  // 批3 (plan 2026-09-20, P1): 回填会再落一次盘——旧图必须被新图替换（不是两份文件、
  // 也不是留着旧字节），且 cover_path 保持同一个库内相对路径。
  it('回填覆盖旧封面：同一路径、字节换成新图', () => {
    const oldPath = saveLessonCover(dir, 'l1', PNG_DATA_URL)
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ=='
    const newPath = saveLessonCover(dir, 'l1', jpeg)
    expect(newPath).toBe(oldPath)
    const absolute = resolveLibraryPath(dir, newPath as string)
    expect(readFileSync(absolute).toString('base64')).toBe('/9j/4AAQSkZJRgABAQAAAQ==')
    expect(readdirSync(join(attachmentsPath(dir), 'l1'))).toEqual([COVER_FILE_NAME])
  })
})
