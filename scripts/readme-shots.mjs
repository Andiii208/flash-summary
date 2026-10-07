/**
 * README screenshot pipeline (plan docs/plans/2026-10-06-readme-screenshot-overhaul.md).
 *
 * Boots the real built app against a THROWAWAY COPY of the real library
 * (app.db + attachments/ — timeline images and the cover live there), pins the
 * OS window to a fixed physical size, walks the README stations over CDP, then
 * crops/compresses the captures into docs/assets/readme/ (the assets the
 * repository README embeds). The real Library, the installed app and the real
 * userData are never touched — same isolation seams as scripts/ui-shots.mjs
 * (SEU_SUMMARY_DOCS_OVERRIDE / ELECTRON_RENDERER_URL) plus SEU_PDF_PATH for the
 * handout export (dev-only seam, bypasses the native save dialog).
 *
 *   node scripts/readme-shots.mjs [--out=docs/assets/readme] [--raw=.ui-shots/readme]
 *                                 [--stations=hero,tasks,...]
 *                                 [--gif-width=960] [--no-gif] [--no-handout]
 *                                 [--keep-raw] [--diag]
 *
 * Stations (filterable via --stations; optional ones log a `note` line and
 * skip when their precondition is missing instead of failing the run):
 *   hero       note page (详细笔记) with course tree — the README hero shot
 *   views      四视图正文裁条（标准总结/要点/方法论/思维导图）→ 2×2 拼图
 *   qa         note page with the floating 追问坞 expanded (real Q&A history)
 *   mindmap    思维导图 view
 *   browser    「全部课程」fullscreen overlay (all courses + filters)
 *   bili       B站导入对话框 (+ resolved preview, best effort, public endpoints)
 *   tasks      task page (history / filters / retry)
 *   running    starts a REAL task, captures the live 6-stage card, then cancels
 *   handout    exports the PDF handout through the app and rasterizes a page
 *   empty      zero-course first run (second boot, empty library)
 *
 * Requires Node >= 22, a fresh `npm run build`, python+pymupdf (handout only)
 * and ffmpeg-static (bundled devDependency). Raw captures land in .ui-shots/
 * (gitignored); processed assets land in docs/assets/readme/ with a manifest.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import {
  ROOT,
  sleep,
  has,
  argOf,
  waitFor,
  clickTab,
  goHome,
  clickByText,
  selectNotedLesson,
  passConsentGate,
  waitForShell,
  acceptConsentGate,
  spawnApp,
  connect,
  killApp,
  removeDir,
  prepareThrowawayDocs,
  prepareThrowawayUserData,
  restoreOsWindow,
  setOsWindowSize
} from './lib/ui-cdp.mjs'

const require = createRequire(import.meta.url)
const FFMPEG = require('ffmpeg-static')

/** CSS viewport anchor from src/main/window-zoom.ts (z = client/1600). */
const CSS_VIEWPORT_ANCHOR = 1600
/** Final asset widths (px in the committed JPEG). */
const STATION_WIDTH = {
  hero: 1440,
  tasks: 1320,
  qa: 1320,
  mindmap: 1320,
  browser: 1320,
  running: 1320,
  empty: 1320,
  gate: 1320,
  bili: 960,
  'bili-preview': 960,
  handout: 1100
}
/** GIF step captions — order here is the playback order. */
const GIF_FRAMES = ['gif-1-browser.png', 'gif-2-running.png', 'gif-3-note.png', 'gif-4-qa.png', 'gif-5-mindmap.png']

const applyTheme = async (cdp, theme) => {
  await cdp.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
  await sleep(350)
}

const pressEscape = (cdp) =>
  cdp.eval(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)

const setNoteView = (cdp, label) => clickByText(cdp, '.note-tabs button', label)

const scrollNoteToTop = (cdp) =>
  cdp.eval(`(() => { const c = document.querySelector('.content'); if (c != null) c.scrollTop = 0; return true })()`)

/**
 * Scroll the note into the body band — the 追问坞 expands to a card there
 * (P50-2). Two passes with a settle gap: the cover image decodes late and
 * grows the masthead by ~600px, which would otherwise leave the body's tail
 * at the fold (2026-10-07: the full-screen window made this visible — the
 * views tiles came out 144px tall).
 */
const scrollNoteIntoBody = async (cdp) => {
  const scrollOnce = () =>
    cdp.eval(`(() => {
      const c = document.querySelector('.content')
      const m = document.querySelector('.note-masthead')
      if (c == null) return false
      c.scrollTop = m == null ? 400 : Math.round(m.getBoundingClientRect().height + c.getBoundingClientRect().top + 200)
      return true
    })()`)
  if ((await scrollOnce()) !== true) return false
  await sleep(700)
  await scrollOnce()
  return true
}

/** Close any toast (e.g. the Fake-IP proxy warning) so it stays out of shots. */
const dismissToasts = (cdp) =>
  cdp.eval(`(() => { const close = [...document.querySelectorAll('.toast-close')]; for (const btn of close) btn.click(); return close.length })()`)

/** Dismiss the one-shot small-window hint (it shifts app-main down ~30px). */
const dismissWindowHint = async (cdp) => {
  await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('[data-testid="window-hint"] button')].find((x) => x.textContent === '知道了')
    if (btn != null) { btn.click(); return true }
    return false
  })()`)
  await sleep(300)
}

const waitForSelector = (cdp, selector, timeoutMs) =>
  waitFor(`selector ${selector}`, async () => {
    try {
      return { ok: (await cdp.eval(`document.querySelector(${JSON.stringify(selector)}) != null`)) === true }
    } catch {
      return { ok: false }
    }
  }, timeoutMs)

/**
 * 2026-10-07: pid of the spawned dev instance. Every window operation is
 * scoped to it so the user's own Flash Summary window is never touched.
 */
let devPid = null

/**
 * Fill the screen, then verify the CSS viewport settled at the 1600 anchor.
 * 2026-10-07 plan: the window is SCREEN-FILLING (Andiii: «没有铺满全屏就直接
 * 截图了») instead of floated at 60,60 — window-zoom clamps physical/1600, so
 * a screen-wide window still renders at 1600 CSS and the captured composition
 * is unchanged, only sharper. Two field-verified constraints shape the steps:
 * SW_RESTORE first (a window created hidden under SEU_SMOKE never produces
 * capture frames — Page.captureScreenshot waits forever), and SW_MAXIMIZE is
 * NOT usable (it hangs capture the same way after a hidden start), so the
 * fill is a SetWindowPos to the primary-screen size plus the invisible-border
 * inset. Verification is not optional: a live run showed the zoom factor
 * silently reset to 1 mid-run (innerWidth 1906, dpr 1.5), which shrank every
 * later capture to 1433 CSS.
 */
async function fillWindow(cdp, pid = devPid) {
  // Physical screen size comes from the renderer (screen.width × devicePixelRatio);
  // PowerShell's Screen.Bounds reports DIPs and SetWindowPos wants physical px.
  const base = await cdp.json(`(() => ({ outer: window.outerWidth, inner: innerWidth, sw: screen.width, sh: screen.height, dpr: devicePixelRatio }))()`)
  const inset = Math.max(0, base.outer - base.inner)
  const screen = { width: Math.round(base.sw * base.dpr), height: Math.round(base.sh * base.dpr) }
  let last = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    restoreOsWindow(pid)
    setOsWindowSize(screen.width + inset, screen.height + inset, pid, 0, 0)
    for (let poll = 0; poll < 8; poll++) {
      await sleep(500)
      last = await cdp.json(`(() => innerWidth)()`)
      if (Math.abs(last - CSS_VIEWPORT_ANCHOR) <= 2) break
    }
    if (last != null && Math.abs(last - CSS_VIEWPORT_ANCHOR) <= 2) {
      return { windowFilled: true, screen, expectedCssWidth: CSS_VIEWPORT_ANCHOR, cssWidth: last }
    }
  }
  throw new Error(`window fill failed: expected css viewport ~${CSS_VIEWPORT_ANCHOR}, last ${last}`)
}

/** Cheap per-station guard: the zoom can drift mid-run; re-fill before shooting. */
async function ensureFullWindow(cdp) {
  const inner = await cdp.json(`(() => innerWidth)()`)
  if (Math.abs(inner - CSS_VIEWPORT_ANCHOR) <= 2) return
  await fillWindow(cdp)
}

/** Crop reference: the self-drawn topbar row is cropped off every full-window shot. */
const measureGeometry = (cdp) =>  cdp.json(`(() => {
    const topbar = document.querySelector('.topbar')
    return {
      cssWidth: innerWidth,
      cssHeight: innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      topbarCssHeight: topbar == null ? 0 : Math.round(topbar.getBoundingClientRect().height)
    }
  })()`)

/** Capture with a burned-in step caption (GIF frames only; no font dependency). */
async function captionShot(cdp, path, text) {
  const style = [
    'position:fixed', 'left:50%', 'top:22px', 'transform:translateX(-50%)',
    'z-index:2147483647', 'background:rgba(18,38,30,.88)', 'color:#f6f1e6',
    'padding:10px 24px', 'border-radius:999px', 'white-space:nowrap',
    'font:600 28px/1.25 "Noto Sans SC","Microsoft YaHei",system-ui,sans-serif',
    'letter-spacing:1px', 'box-shadow:0 8px 28px rgba(0,0,0,.28)'
  ].join(';')
  await cdp.eval(`(() => {
    const el = document.createElement('div')
    el.id = '__readmeShotCaption'
    el.setAttribute('style', ${JSON.stringify(style)})
    el.textContent = ${JSON.stringify(text)}
    document.body.appendChild(el)
    return true
  })()`)
  await sleep(300)
  await cdp.shot(path)
  await cdp.eval(`(() => { document.getElementById('__readmeShotCaption')?.remove(); return true })()`)
  await sleep(150)
}

/**
 * Capture the VISIBLE band of one element (views strip tiles). Tries the
 * selectors in order; the rect is clamped to the viewport, because a clip
 * taller than the fold captures the whole (offscreen) element.
 */
async function clipShot(cdp, path, selectors) {
  const rect = await cdp.json(`(() => {
    for (const selector of ${JSON.stringify(selectors)}) {
      const el = document.querySelector(selector)
      if (el == null) continue
      const box = el.getBoundingClientRect()
      if (box.width < 50 || box.height < 50) continue
      const top = Math.max(0, Math.round(box.top))
      const bottom = Math.min(innerHeight, Math.round(box.bottom))
      if (bottom - top < 50) continue
      return { x: Math.round(box.left), y: top, width: Math.round(box.width), height: bottom - top }
    }
    return null
  })()`)
  if (rect == null) return null
  mkdirSync(join(path, '..'), { recursive: true })
  const { data } = await cdp.captureWithRetry({ format: 'png', clip: { ...rect, scale: 1 } })
  writeFileSync(path, Buffer.from(data, 'base64'))
  console.log(`clip  ${path} (${rect.width}×${rect.height} css)`)
  return rect
}

/** Wait for the live task card (not the failed variant); null when it never went live. */
async function waitLiveTaskCard(cdp) {
  try {
    return await waitFor('live task card', async () => {
      try {
        const state = await cdp.json(`(() => {
          const el = document.querySelector('[data-testid="task-status"]')
          if (el == null) return null
          return { failed: el.classList.contains('failed'), text: el.textContent.trim().slice(0, 60) }
        })()`)
        if (state == null) return { ok: false }
        if (state.failed) return { ok: true, value: { failed: true, text: state.text } }
        const live = await cdp.eval(`(() => {
          const el = document.querySelector('[data-testid="task-status"]')
          return el != null && /阶段|下载|转写|关键帧|总结|排队/.test(el.textContent)
        })()`)
        return { ok: live === true, value: { failed: false, text: state.text } }
      } catch {
        return { ok: false }
      }
    }, 180000)
  } catch (error) {
    console.log(`note  running station skipped (${error.message})`)
    return null
  }
}

/* ---------------- stations (session 1: real library) ---------------- */

async function stationHero(cdp, rawDir) {
  await ensureFullWindow(cdp)
  await selectNotedLesson(cdp)
  await clickTab(cdp, '笔记')
  await sleep(900)
  if ((await setNoteView(cdp, '详细笔记')) !== true) throw new Error('详细笔记 view tab not found')
  await waitForSelector(cdp, '.note-body', 10000)
  await sleep(1500) // cover + first timeline frames decode
  await scrollNoteToTop(cdp)
  await sleep(400)
  await cdp.shot(join(rawDir, 'hero.png'))
  await captionShot(cdp, join(rawDir, 'gif-3-note.png'), '③ 多模态笔记自动生成')
}

async function stationViews(cdp, rawDir) {
  await ensureFullWindow(cdp)
  const tiles = [
    { view: '标准总结', file: 'view-standard.png' },
    { view: '要点', file: 'view-points.png' },
    { view: '方法论', file: 'view-methodology.png' },
    { view: '思维导图', file: 'view-mindmap.png' }
  ]
  for (const tile of tiles) {
    if ((await setNoteView(cdp, tile.view)) !== true) throw new Error(`note view tab not found: ${tile.view}`)
    await sleep(1200)
    // Past the masthead first: on the hero band the body column starts at the
    // very bottom of the viewport and the visible band would be empty.
    await scrollNoteIntoBody(cdp)
    await sleep(400)
    const selectors = tile.view === '思维导图' ? ['.mindmap-scroll', '.mindmap-wrap', '.note-body'] : ['.note-body']
    const rect = await clipShot(cdp, join(rawDir, tile.file), selectors)
    if (rect == null) console.log(`note  ${tile.view} body clip not captured`)
  }
  await setNoteView(cdp, '详细笔记')
}

async function stationQa(cdp, rawDir) {
  await ensureFullWindow(cdp)
  await scrollNoteIntoBody(cdp)
  await waitForSelector(cdp, '.qa-dock', 8000)
  await sleep(1200) // markdown answer renders
  await cdp.shot(join(rawDir, 'qa.png'))
  await captionShot(cdp, join(rawDir, 'gif-4-qa.png'), '④ 读到哪里，问到哪里')
}

async function stationMindmap(cdp, rawDir) {
  await ensureFullWindow(cdp)
  if ((await setNoteView(cdp, '思维导图')) !== true) throw new Error('思维导图 view tab not found')
  await waitForSelector(cdp, '.mindmap-scroll svg', 10000)
  await sleep(1600) // fit-ratio layout settles
  await cdp.shot(join(rawDir, 'mindmap.png'))
  await captionShot(cdp, join(rawDir, 'gif-5-mindmap.png'), '⑤ 导图 · 五视图 · PDF 讲义导出')
}

async function stationBrowser(cdp, rawDir) {
  await ensureFullWindow(cdp)
  const opened = await cdp.eval(`(() => { document.querySelector('[data-testid="course-browser-open"]')?.click(); return true })()`)
  if (opened !== true) throw new Error('course browser entry not found')
  await waitForSelector(cdp, '.course-browser-card', 15000)
  await sleep(1400) // grid + course covers settle
  await cdp.shot(join(rawDir, 'browser.png'))
  await captionShot(cdp, join(rawDir, 'gif-1-browser.png'), '① 全部课程一屏浏览，点课时即入')
  await pressEscape(cdp)
  await sleep(700)
}

async function stationBili(cdp, rawDir) {
  await ensureFullWindow(cdp)
  const opened = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('.sidebar-head button')].find((b) => b.textContent.trim() === '导入 B站视频')
    if (btn == null) return false
    btn.click()
    return true
  })()`)
  if (opened !== true) throw new Error('sidebar B站 entry button not found')
  await waitForSelector(cdp, "[data-testid='bili-import-dialog']", 20000)
  await sleep(1000)
  await cdp.shot(join(rawDir, 'bili.png'))
  try {
    // Resolved preview: public endpoints only (ui-shots --bili precedent), no account writes.
    await cdp.eval(`(() => { const input = document.querySelector('.bili-dialog-card .qa-input'); if (input == null) return false; input.focus(); return true })()`)
    await cdp.send('Input.insertText', { text: 'BV1GJ411x7h7' })
    await sleep(300)
    const resolved = await cdp.eval(`(() => {
      const btn = [...document.querySelectorAll('.bili-dialog-card button')].find((b) => b.textContent.trim() === '解析')
      if (btn == null) return false
      btn.click()
      return true
    })()`)
    if (resolved !== true) throw new Error('解析 button not found')
    await waitForSelector(cdp, '.bili-preview', 25000)
    await sleep(1600) // cover data URL decode
    await cdp.shot(join(rawDir, 'bili-preview.png'))
  } catch (error) {
    console.log(`note  bili preview skipped (${error.message})`)
  }
  await pressEscape(cdp)
  await sleep(700)
}

async function stationTasks(cdp, rawDir) {
  await ensureFullWindow(cdp)
  await goHome(cdp)
  await sleep(500)
  await clickTab(cdp, '任务')
  await waitFor('task history rows', async () => {
    try {
      const rows = await cdp.eval(`document.querySelectorAll('.history-row').length`)
      return { ok: typeof rows === 'number' && rows > 0, value: rows }
    } catch {
      return { ok: false }
    }
  }, 10000)
  await sleep(900)
  await cdp.shot(join(rawDir, 'tasks.png'))
}

/**
 * Running station: import a real public B站 video through the app — import
 * auto-queues a task, which yields an authentic live 6-stage card without
 * depending on pre-existing not-yet-noted lessons. Public endpoints only
 * (ui-shots --bili precedent); BV1GJ411x7h7 is not in the library (no
 * attachments dir), so the import always creates a fresh lesson.
 */
async function stationRunning(cdp, rawDir) {
  await ensureFullWindow(cdp)
  const opened = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('.sidebar-head button')].find((b) => b.textContent.trim() === '导入 B站视频')
    if (btn == null) return false
    btn.click()
    return true
  })()`)
  if (opened !== true) throw new Error('sidebar B站 entry button not found')
  await waitForSelector(cdp, "[data-testid='bili-import-dialog']", 20000)
  await cdp.eval(`(() => { const input = document.querySelector('.bili-dialog-card .qa-input'); if (input == null) return false; input.focus(); return true })()`)
  await cdp.send('Input.insertText', { text: 'BV1GJ411x7h7' })
  await sleep(300)
  const resolved = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('.bili-dialog-card button')].find((b) => b.textContent.trim() === '解析')
    if (btn == null) return false
    btn.click()
    return true
  })()`)
  if (resolved !== true) {
    console.log('note  解析 button not found — running station skipped')
    await pressEscape(cdp)
    return
  }
  // Optional station: a failed public resolve (bilibili risk control 412, or
  // the resolve rate-limiting after the bili station) must skip, not kill the
  // whole run (2026-10-07: it threw here and took the handout/empty stations
  // down with it).
  try {
    await waitForSelector(cdp, '.bili-preview', 25000)
  } catch {
    console.log('note  bili preview not resolved — running station skipped')
    await pressEscape(cdp)
    return
  }
  await sleep(1200)
  if ((await clickByText(cdp, '.bili-import-btn', '导入并生成笔记')) !== true) {
    console.log('note  导入并生成笔记 not clickable — running station skipped')
    await pressEscape(cdp)
    return
  }
  await clickTab(cdp, '任务')
  // Capture the live stage track as soon as the card appears (stage 1 is
  // enough) and cancel before the expensive stages run.
  const card = await waitLiveTaskCard(cdp)
  if (card == null) return
  if (card.failed === true) {
    console.log(`note  running station skipped (task card failed immediately: ${card.text})`)
    return
  }
  await sleep(2000) // stage track + progress bar fill in
  await dismissToasts(cdp) // the Fake-IP proxy warning must stay out of the shopfront
  await sleep(300)
  await cdp.shot(join(rawDir, 'running.png'))
  await captionShot(cdp, join(rawDir, 'gif-2-running.png'), '② 导入即排队，六阶段流水线实时可见')
  await clickByText(cdp, 'button', '取消任务')
  await sleep(1500)
}

/** Export the real handout through the app (SEU_PDF_PATH seam), then rasterize. */
async function stationHandout(cdp, rawDir, pdfPath) {
  await ensureFullWindow(cdp)
  await selectNotedLesson(cdp)
  await clickTab(cdp, '笔记')
  await sleep(1200)
  if ((await clickByText(cdp, 'button', '导出 PDF 讲义')) !== true) throw new Error('导出 PDF 讲义 button not found')
  await waitFor('export notice', async () => {
    try {
      return { ok: (await cdp.eval(`document.body.textContent.includes('导出提醒')`)) === true }
    } catch {
      return { ok: false }
    }
  }, 8000)
  await sleep(400)
  if ((await clickByText(cdp, '.dialog-actions button', '继续导出')) !== true) throw new Error('导出提醒 继续导出 button not found')
  await waitFor('handout pdf written', async () => ({ ok: existsSync(pdfPath) && statSync(pdfPath).size > 1024, value: pdfPath }), 120000, 500)
  const outPng = join(rawDir, 'handout.png')
  // The page carrying the most embedded images is the timeline page with the
  // real classroom frames (the cover has none, the mindmap page has the svg).
  execFileSync('python', ['-c', `import pymupdf; d = pymupdf.open(r'${pdfPath}'); pages = [d[i] for i in range(min(12, len(d)))]; best = max(pages, key=lambda p: len(p.get_images())); best.get_pixmap(dpi=150).save(r'${outPng}')`])
  console.log(`raster  ${outPng} <- handout.pdf`)
}

/* ---------------- session 2: empty library ---------------- */

async function stationEmpty(rawDir) {
  // The single-instance lock forces a fresh boot after session 1 is killed.
  const tmpDocs = prepareThrowawayDocs({ empty: true })
  const { electron, port } = await spawnApp(tmpDocs)
  devPid = electron.pid ?? null
  try {
    const cdp = await connect(port)
    if ((await waitForShell(cdp)) === 'gate') {
      await applyTheme(cdp, 'light')
      await sleep(500)
      await cdp.shot(join(rawDir, 'gate.png'))
      await acceptConsentGate(cdp)
    }
    await fillWindow(cdp)
    await dismissWindowHint(cdp)
    await applyTheme(cdp, 'light')
    await waitForSelector(cdp, '.empty-state', 15000)
    await sleep(1200)
    await cdp.shot(join(rawDir, 'empty.png'))
  } finally {
    killApp(electron)
    await removeDir(tmpDocs)
  }
}

/* ---------------- processing ---------------- */

const pngSize = (file) => {
  const buffer = readFileSync(file)
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** Crop the self-drawn topbar row off, then scale down; JPEG q3 (promo parity). */
function processShot(srcPng, destJpg, { targetWidth, cropTopFraction = 0, quality = 3 }) {
  const size = pngSize(srcPng)
  const cropPx = Math.round(size.height * cropTopFraction)
  const filters = []
  if (cropPx > 0) filters.push(`crop=iw:ih-${cropPx}:0:${cropPx}`)
  filters.push(`scale=${targetWidth}:-1:flags=lanczos`)
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', srcPng, '-vf', filters.join(','), '-q:v', String(quality), destJpg])
  return { width: targetWidth, bytes: statSync(destJpg).size }
}

/** 2×2 grid of the four view-body tiles, uniform tile width/height. */
function buildViewsStrip(rawDir, destJpg, tileWidth = 560) {
  const tiles = ['view-standard.png', 'view-points.png', 'view-methodology.png', 'view-mindmap.png'].map((file) => {
    const src = join(rawDir, file)
    if (!existsSync(src)) throw new Error(`views strip tile missing: ${file}`)
    const size = pngSize(src)
    return { src, scaled: join(rawDir, `strip-${file.replace('.png', '.jpg')}`), width: tileWidth, height: Math.round((size.height * tileWidth) / size.width) }
  })
  const tileHeight = Math.min(...tiles.map((tile) => tile.height))
  for (const tile of tiles) {
    execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', tile.src, '-vf', `scale=${tileWidth}:${tileHeight}:flags=lanczos`, '-q:v', '3', tile.scaled])
  }
  const filter = '[0:v][1:v]hstack=inputs=2[top];[2:v][3:v]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2[out]'
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...tiles.flatMap((tile) => ['-i', tile.scaled]),
    '-filter_complex', filter,
    '-map', '[out]', '-q:v', '3', destJpg
  ])
  return { width: tileWidth * 2, bytes: statSync(destJpg).size }
}

/** Assemble the step GIF from the captioned frames (discrete steps, ~1.2s each). */
function buildGif(rawDir, outDir, width) {
  const frames = GIF_FRAMES.filter((file) => existsSync(join(rawDir, file)))
  if (frames.length < 3) {
    console.log('note  fewer than 3 gif frames captured — gif skipped')
    return null
  }
  const framesDir = join(rawDir, 'gif-frames')
  rmSync(framesDir, { recursive: true, force: true })
  mkdirSync(framesDir, { recursive: true })
  // geometry.json is written by the capturing run (same window pin, same topbar).
  const geometry = JSON.parse(readFileSync(join(rawDir, 'geometry.json'), 'utf8'))
  const topbarFraction = geometry.topbarCssHeight / geometry.cssHeight
  frames.forEach((file, index) => {
    const size = pngSize(join(rawDir, file))
    const cropPx = Math.round(size.height * topbarFraction)
    const digits = String(index + 1).padStart(2, '0')
    execFileSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', join(rawDir, file),
      '-vf', `crop=iw:ih-${cropPx}:0:${cropPx},scale=${width}:-1:flags=lanczos`,
      '-frames:v', '1', join(framesDir, `frame-${digits}.png`)
    ])
  })
  const dest = join(outDir, 'demo.gif')
  execFileSync(FFMPEG, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-framerate', '0.85',
    '-i', join(framesDir, 'frame-%02d.png'),
    '-vf', 'split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    '-loop', '0', dest
  ])
  return { width, bytes: statSync(dest).size }
}

/* ---------------- main ---------------- */

async function main() {
  const outDir = argOf('--out=') ?? join(ROOT, 'docs', 'assets', 'readme')
  const rawDir = argOf('--raw=') ?? join(ROOT, '.ui-shots', 'readme')
  const stationFilter = argOf('--stations=')?.split(',').filter(Boolean) ?? null
  const want = (name) => stationFilter == null || stationFilter.includes(name)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(rawDir, { recursive: true })

  const outMain = join(ROOT, 'out', 'main', 'index.cjs')
  if (!existsSync(outMain)) {
    console.error('out/main/index.cjs missing — run `npm run build` first')
    process.exit(1)
  }

  const tmpDocs = prepareThrowawayDocs({ withAttachments: true })
  const pdfPath = join(tmpDocs, 'handout.pdf')
  // 2026-10-07: the smoke userData seam + a throwaway copy of the encrypted
  // session, so the run renders the logged-in shell (the -dev userData's
  // stale session would hide the semester selector from every sidebar shot).
  const tmpUserData = prepareThrowawayUserData()
  const { electron, port } = await spawnApp(tmpDocs, {
    SEU_PDF_PATH: pdfPath,
    SEU_SMOKE: '1',
    SEU_SHOW: '1',
    SEU_SMOKE_USER_DATA: tmpUserData
  })
  // The spawned instance's pid scopes every window operation to the dev app
  // — the user may have their own Flash Summary window open.
  devPid = electron.pid ?? null
  const geometry = {}
  try {
    const cdp = await connect(port)
    await passConsentGate(cdp)
    await dismissWindowHint(cdp)
    Object.assign(geometry, await fillWindow(cdp, devPid))
    Object.assign(geometry, await measureGeometry(cdp))
    writeFileSync(join(rawDir, 'geometry.json'), `${JSON.stringify(geometry, null, 1)}\n`)
    console.log(`filled screen → css viewport ${geometry.cssWidth}×${geometry.cssHeight} · topbar ${geometry.topbarCssHeight} css · dpr ${geometry.devicePixelRatio}`)
    await applyTheme(cdp, 'light')

    if (has('--diag')) {
      await selectNotedLesson(cdp)
      await clickTab(cdp, '笔记')
      await sleep(1200)
      await cdp.shot(join(rawDir, 'diag-full.png'))
      const rect = await clipShot(cdp, join(rawDir, 'diag-clip.png'), ['.note-body'])
      const full = pngSize(join(rawDir, 'diag-full.png'))
      const clipped = rect == null ? null : pngSize(join(rawDir, 'diag-clip.png'))
      console.log(`diag full ${full.width}×${full.height} · clip req ${JSON.stringify(rect)} → ${clipped == null ? 'none' : `${clipped.width}×${clipped.height}`}`)
      return
    }

    if (want('hero')) await stationHero(cdp, rawDir)
    if (want('views')) await stationViews(cdp, rawDir)
    if (want('qa')) await stationQa(cdp, rawDir)
    if (want('mindmap')) await stationMindmap(cdp, rawDir)
    if (want('browser')) await stationBrowser(cdp, rawDir)
    if (want('bili')) await stationBili(cdp, rawDir)
    if (want('tasks')) await stationTasks(cdp, rawDir)
    if (want('running')) await stationRunning(cdp, rawDir)
    if (want('handout') && !has('--no-handout')) await stationHandout(cdp, rawDir, pdfPath)
  } finally {
    killApp(electron)
    await removeDir(tmpDocs)
    await removeDir(tmpUserData)
  }

  if (want('empty')) await stationEmpty(rawDir)
  if (has('--diag')) return

  // ---- process raw captures into committed assets ----
  const geometryFile = join(rawDir, 'geometry.json')
  const finalGeometry = existsSync(geometryFile) ? JSON.parse(readFileSync(geometryFile, 'utf8')) : geometry
  const topbarFraction = finalGeometry.topbarCssHeight / finalGeometry.cssHeight
  const manifest = {}
  for (const [name, width] of Object.entries(STATION_WIDTH)) {
    const src = join(rawDir, `${name}.png`)
    if (!existsSync(src)) continue
    const dest = join(outDir, `${name}.jpg`)
    const result = processShot(src, dest, { targetWidth: width, cropTopFraction: name === 'handout' ? 0 : topbarFraction })
    manifest[name] = { station: name, width: result.width, bytes: result.bytes }
    console.log(`asset ${name}.jpg ${result.width}w ${(result.bytes / 1024).toFixed(0)}KB`)
  }
  if (existsSync(join(rawDir, 'view-standard.png'))) {
    const strip = buildViewsStrip(rawDir, join(outDir, 'views-strip.jpg'))
    manifest['views-strip'] = { station: 'views', width: strip.width, bytes: strip.bytes }
    console.log(`asset views-strip.jpg ${strip.width}w ${(strip.bytes / 1024).toFixed(0)}KB`)
  }
  if (!has('--no-gif')) {
    const gif = buildGif(rawDir, outDir, Number(argOf('--gif-width=') ?? 960))
    if (gif != null) {
      manifest['demo.gif'] = { station: 'gif', width: gif.width, bytes: gif.bytes }
      console.log(`asset demo.gif ${gif.width}w ${(gif.bytes / 1024 / 1024).toFixed(2)}MB`)
    }
  }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`)
  const total = Object.values(manifest).reduce((sum, entry) => sum + entry.bytes, 0)
  console.log(`\n${Object.keys(manifest).length} assets → ${outDir} (total ${(total / 1024 / 1024).toFixed(2)}MB)`)
  if (!has('--keep-raw')) await removeDir(rawDir)
}

await main()
