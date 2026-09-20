/**
 * 课时封面资产（批 A2, plan 2026-09-19-note-experience-overhaul）。
 *
 * B 站导入时封面 pic 早已解析（`bilibili/parse.ts:64`）并在 resolve 通道下载成
 * data URL（`ipc.ts` bilibili:resolve）——但它只活到导入对话框的预览缩略图，
 * 之后即被丢弃。本模块把「已经在手」的 data URL 落盘成库内资产：
 * `attachments/<lessonId>/cover.jpg`（与关键帧/PPT 同一路径规约，migration 012
 * 的 `lessons.cover_path` 存库内相对路径）。
 *
 * 纪律：**best-effort，绝不因封面失败而弄坏导入**——任何异常都吞掉返回 null，
 * 渲染端用第一张关键帧兜底（SEU 源本来就没有封面）。
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { attachmentsPath, storedAttachmentsPath } from '../library/paths'

/** 封面文件名的单一事实源（渲染端取图与导入落盘共用）。 */
export const COVER_FILE_NAME = 'cover.jpg'

/** data URL 的最大字节数——封面不该超过几百 KB，防异常响应写爆磁盘。 */
const MAX_COVER_BYTES = 2 * 1024 * 1024

/** 解析 data URL（只接受 base64 图片）；失败返回 null。 */
function decodeImageDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim())
  if (match == null) return null
  try {
    const buffer = Buffer.from(match[1]!.replace(/\s+/g, ''), 'base64')
    if (buffer.length === 0 || buffer.length > MAX_COVER_BYTES) return null
    return buffer
  } catch {
    return null
  }
}

/**
 * 把封面 data URL 落盘到 `attachments/<lessonId>/cover.jpg`。
 * 返回库内**相对路径**（供 `lessons.cover_path`）；任何失败返回 null（不抛）。
 */
export function saveLessonCover(libraryRoot: string, lessonId: string, dataUrl: string): string | null {
  const buffer = decodeImageDataUrl(dataUrl)
  if (buffer == null) return null
  try {
    const dir = join(attachmentsPath(libraryRoot), lessonId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, COVER_FILE_NAME), buffer)
    return storedAttachmentsPath(lessonId, COVER_FILE_NAME)
  } catch {
    return null
  }
}
