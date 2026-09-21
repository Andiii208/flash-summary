/**
 * PDF export core (2026-09-04): the MAIN WINDOW's own webContents prints
 * itself — the renderer renders the handout into #print-root and print.css
 * swaps it in under print media. No second BrowserWindow (this machine has
 * a known second-renderer commit failure; see PROGRESS), no headless
 * Chromium, output is vector text.
 */
import { writeFileSync } from 'fs'
import type { WebContents } from 'electron'

/** Page-number footer shown on every printed page. */
const FOOTER_TEMPLATE =
  '<div style="font-size:9px; width:100%; text-align:center; color:#9aa0ad;">' +
  '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页 · Flash Summary</div>'

/** 批4: per-page header — the renderer lends document.title the course·lesson identity. */
const HEADER_TEMPLATE =
  '<div style="font-size:8px; width:100%; text-align:center; color:#b3b8c2;' +
  'white-space:nowrap; overflow:hidden;"><span class="title"></span></div>'

export interface PdfPrintOptions {
  /** Target file path (already validated writable by the caller). */
  filePath: string
}

/** Print the given webContents to PDF and write it to filePath.
 *
 *  P28 (plan 2026-09-21): 窗口缩放（zoomFactor≠1）会把 A4 讲义版式按倍率缩放、
 *  分页错乱——打印前把缩放钉回 1.0，结束后恢复用户当前的窗口缩放档。恢复放在
 *  finally：导出失败也不该把用户的界面缩放悄悄留在 1.0。 */
export async function printToPdfFile(webContents: WebContents, filePath: string): Promise<number> {
  const zoom = webContents.getZoomFactor()
  if (zoom !== 1) webContents.setZoomFactor(1)
  try {
    const buffer = await webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: FOOTER_TEMPLATE,
      // 批4 版式重做: wider margins kill the edge-to-edge wall of text —
      // ~17.8mm top (header strip), ~16.5mm bottom (footer), 17.8mm sides.
      margins: { top: 0.7, bottom: 0.65, left: 0.7, right: 0.7 }
    })
    writeFileSync(filePath, buffer)
    return buffer.byteLength
  } finally {
    if (zoom !== 1) webContents.setZoomFactor(zoom)
  }
}
