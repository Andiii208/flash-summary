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
  '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页 · SEU Summary</div>'

export interface PdfPrintOptions {
  /** Target file path (already validated writable by the caller). */
  filePath: string
}

/** Print the given webContents to PDF and write it to filePath. */
export async function printToPdfFile(webContents: WebContents, filePath: string): Promise<number> {
  const buffer = await webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: FOOTER_TEMPLATE,
    // ~15mm top/bottom (footer), 12mm sides — inches per the Electron API.
    margins: { top: 0.59, bottom: 0.59, left: 0.47, right: 0.47 }
  })
  writeFileSync(filePath, buffer)
  return buffer.byteLength
}
