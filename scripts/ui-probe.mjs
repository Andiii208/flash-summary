/**
 * Layout probe: boots the built app against a THROWAWAY copy of the real
 * library and measures the rendered geometry over CDP, so layout claims are
 * numbers instead of impressions. Read-only — it clicks around the UI but
 * never writes to the real Library or userData.
 *
 *   node scripts/ui-probe.mjs [--empty] [--width=960] [--shot]
 *                             [--dialog] [--provider] [--mindmap] [--out=path]
 *
 *   （无参数）      默认视口：走一遍「选一个已有笔记的课时 → 笔记 / 追问 / 任务」
 *                  三个页面，量内容轴、正文行长、工具行、弹窗、任务行列宽。
 *   --empty        空库首启（不拷贝真实库）：量侧栏引导卡与主区首启卡。
 *   --width=960    追加一轮窄窗测量（Emulation 覆盖视口，不改窗口）。
 *   --shot         额外存图（空库首启两态；其它模式各自目录）。
 *   --dialog       第三方许可弹层在 960×600 下的钳制与滚动（T36 取证）。
 *   --provider     绑定能力复选框组的布局（T30 取证）。
 *   --mindmap      导图：首屏适应窗口、放大后适应、窄窗适应三态（T15 取证）。
 *   --note-search=词  笔记库搜索（主进程过滤）：量标题、命中行数与分组。
 *   --seed-notes=N  往**副本库**注入 N 个合成课时（各带一条笔记），用来验分页：
 *                   「显示更多」在真实代码路径上是否按页加长。真实库只有个位数笔记，
 *                   不造材就永远验不到 100 条那一页。
 *
 * 隔离：SEU_SUMMARY_DOCS_OVERRIDE 指向临时目录（拷贝 app.db 一份），真实
 * Library 与已安装版全程不碰——沿用 scripts/ui-shots.mjs 的同一条缝。
 * 需要 Node >= 22（原生 WebSocket/fetch）与一次 `npm run build`。
 *
 * 输出：默认写 `.ui-shots/probe.json`（gitignored），并在终端打印关键数字摘要。
 */
import { spawn, execFileSync } from 'child_process'
import { createServer } from 'http'
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const APP_TITLE = 'Flash Summary'
const REAL_LIBRARY = join(homedir(), 'Documents', 'SEU Summary', 'Library')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const has = (flag) => process.argv.includes(flag)
const argOf = (prefix) => {
  const found = process.argv.find((a) => a.startsWith(prefix))
  return found == null ? null : found.slice(prefix.length)
}
const NARROW = argOf('--width=') == null ? null : Number(argOf('--width='))
const OUT_FILE = argOf('--out=') ?? join(ROOT, '.ui-shots', 'probe.json')

async function waitFor(label, fn, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await fn()
    if (last.ok) return last.value
    await sleep(intervalMs)
  }
  throw new Error(`${label} timeout (last: ${JSON.stringify(last?.value ?? null)})`)
}

/** Minimal CDP client over the DevTools WebSocket. */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data))
      if (m.id == null || !this.pending.has(m.id)) return
      const { resolve, reject } = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (m.error != null) reject(new Error(`CDP ${m.error.code}: ${m.error.message}`))
      else resolve(m.result)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (r.exceptionDetails != null) throw new Error(`eval threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result?.value
  }
  async json(expr) {
    return JSON.parse(await this.eval(`JSON.stringify(${expr})`))
  }
  async shot(path) {
    mkdirSync(join(path, '..'), { recursive: true })
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(data, 'base64'))
    console.log(`shot ${path}`)
  }
  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await sleep(600)
  }
  async clearViewport() {
    await this.send('Emulation.clearDeviceMetricsOverride')
    await sleep(400)
  }
}

function findFreePort(start) {
  return new Promise((resolve) => {
    const probe = (p) => {
      const s = createServer()
      s.once('error', () => probe(p + 1))
      s.once('listening', () => s.close(() => resolve(p)))
      s.listen(p, '127.0.0.1')
    }
    probe(start)
  })
}

/** One page's worth of geometry, all in CSS px. */
const MEASURE = `(() => {
  const R = (sel) => { const e = document.querySelector(sel); if (e == null) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) } }
  const CS = (sel, ...props) => { const e = document.querySelector(sel); if (e == null) return null; const s = getComputedStyle(e); const o = {}; for (const p of props) o[p] = s[p]; return o }
  const OV = (sel) => { const e = document.querySelector(sel); if (e == null) return null; return { sw: e.scrollWidth, cw: e.clientWidth, over: e.scrollWidth - e.clientWidth } }
  const T = (sel) => { const e = document.querySelector(sel); if (e == null) return null; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); const fs = parseFloat(s.fontSize); const lh = parseFloat(s.lineHeight); return { fs, lh, w: Math.round(r.width), lines: lh > 0 ? +(r.height / lh).toFixed(2) : null, cjkPerLine: +(r.width / fs).toFixed(1) } }
  const btns = [...document.querySelectorAll('.note-actions button')]
  const row = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }
  return {
    viewport: { w: innerWidth, h: innerHeight },
    content: R('.content'),
    noteViewer: R('.note-viewer'),
    noteBody: R('.note-body'),
    masthead: R('.note-masthead'),
    noteToolbar: R('.note-toolbar'),
    noteActions: R('.note-actions'),
    firstSection: R('.note-section'),
    feedbackSection: R('.feedback-section'),
    firstPara: T('.note-section p'),
    mdPara: T('.md-lite .md-para'),
    qaA: T('.qa-a'),
    noteTitle: T('.note-title'),
    noteTitleInfo: (() => { const e = document.querySelector('.note-title'); return e == null ? null : { cls: e.className, len: e.textContent.length, fs: getComputedStyle(e).fontSize } })(),
    mdHeads: [...document.querySelectorAll('.md-h')].map((e) => [e.className, getComputedStyle(e).fontSize, e.textContent.slice(0, 12)]),
    toolbarOV: OV('.note-toolbar'),
    actionsOV: OV('.note-actions'),
    noteBodyOV: OV('.note-body'),
    tabs: CS('.tabs button', 'padding', 'fontSize', 'fontWeight'),
    tabsBox: R('.tabs'),
    noteTabs: CS('.note-tabs button', 'padding', 'fontSize'),
    noteTabsBox: R('.note-tabs'),
    dialogTitle: CS('.dialog-title', 'fontSize'),
    countHeights: [...document.querySelectorAll('.course-count, .tree-count, .all-courses-count, .note-library-count')].map((e) => +e.getBoundingClientRect().height.toFixed(1)),
    noteBtnCount: btns.length,
    noteBtnBoxes: btns.map((b) => ({ t: b.textContent.trim().slice(0, 8), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
    actionsRows: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top))).size,
    contentOverflowX: (() => { const c = document.querySelector('.content'); return c == null ? null : c.scrollWidth - c.clientWidth })(),
    cardPads: ['task-status', 'settings-block', 'note-health-panel', 'concept-card', 'formula-item', 'quiz-card', 'provider-row', 'course-card', 'empty-state'].map((c) => { const e = document.querySelector('.' + c); return e == null ? null : [c, getComputedStyle(e).padding] }),
    history: [...document.querySelectorAll('.history-row')].slice(0, 6).map((r) => ({
      w: Math.round(r.getBoundingClientRect().width),
      labelW: r.querySelector('.history-label') != null ? Math.round(r.querySelector('.history-label').getBoundingClientRect().width) : null,
      errW: r.querySelector('.history-error') != null ? Math.round(r.querySelector('.history-error').getBoundingClientRect().width) : null,
      timeW: r.querySelector('.history-time') != null ? Math.round(r.querySelector('.history-time').getBoundingClientRect().width) : null,
      timeHidden: r.querySelector('.history-time') != null && getComputedStyle(r.querySelector('.history-time')).display === 'none',
      btnLefts: [...r.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().left))
    })),
    upgradeList: (() => { const e = document.querySelector('.note-upgrade-list'); if (e == null) return null; const d = document.querySelector('.dialog'); const lr = e.getBoundingClientRect(); const dr = d.getBoundingClientRect(); const body = document.querySelector('.dialog-body'); return { listW: Math.round(lr.width), dialogW: Math.round(dr.width), overflowPx: Math.round(lr.right - dr.right), dialogH: Math.round(dr.height), top: Math.round(dr.top), bottom: Math.round(dr.bottom), vh: innerHeight, fitsH: dr.top >= 0 && dr.bottom <= innerHeight, maxH: getComputedStyle(d).maxHeight, bodyScrolls: body != null && body.scrollHeight > body.clientHeight + 1 } })(),
    welcome: (() => { const w = document.querySelector('.welcome-guide'); if (w == null) return null; const btns = [...w.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), ...row(b) })); return { boxW: Math.round(w.getBoundingClientRect().width), btns } })(),
    subheadings: [...document.querySelectorAll('.subheading')].map((e) => e.textContent.trim()),
    emptyCards: [...document.querySelectorAll('.empty-state, .course-browser-empty, .msg')].slice(0, 5).map((e) => [e.className, getComputedStyle(e).padding, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)])
  }
})()`

/**
 * 批C 批3: 往副本库注入 N 个「课时 + 笔记」——只为把列表撑到分页阈值以上。
 * 只动副本（临时目录），真实库不碰；note_json 给最小合法串（列表查询不解析它）。
 */
function seedNotes(dbPath, count) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  db.prepare('INSERT OR IGNORE INTO courses (id, name, teacher, fetched_at) VALUES (?, ?, ?, ?)').run('probe-course', '分页造材课程', '探针', now)
  const lesson = db.prepare('INSERT OR REPLACE INTO lessons (id, course_id, title, fetched_at) VALUES (?, ?, ?, ?)')
  const note = db.prepare('INSERT OR REPLACE INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)')
  for (let i = 0; i < count; i++) {
    const id = `probe-l${i}`
    lesson.run(id, 'probe-course', `造材第 ${i + 1} 讲`, now)
    note.run(`probe-n${i}`, id, '{}', 'probe', 'probe', now)
  }
  db.close()
  console.log(`seeded ${count} synthetic lessons into the throwaway library`)
}

/** Copy app.db (WAL-safe by copy) into a throwaway docs dir; --empty skips it. */
function prepareLibrary() {
  const tmpDocs = mkdtempSync(join(tmpdir(), 'seu-probe-'))
  if (has('--empty')) return tmpDocs
  const tmpLib = join(tmpDocs, 'SEU Summary', 'Library')
  mkdirSync(tmpLib, { recursive: true })
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const src = join(REAL_LIBRARY, f)
    if (existsSync(src)) copyFileSync(src, join(tmpLib, f))
  }
  return tmpDocs
}

async function connect(port) {
  const target = await waitFor('main window', async () => {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const m = list.find((t) => t.type === 'page' && t.title.includes(APP_TITLE))
      return { ok: m != null, value: m }
    } catch {
      return { ok: false }
    }
  }, 30000)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('WebSocket connect failed')), { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  return cdp
}

/** A library without recorded consent stops at the 使用须知 gate — walk it. */
async function passConsentGate(cdp) {
  const state = () => cdp.json(`({ gate: document.querySelector('[data-testid="consent-clauses"]') != null, shell: document.querySelector('.app-shell') != null })`)
  await waitFor('shell or consent gate', async () => {
    try {
      const s = await state()
      return { ok: s.gate || s.shell, value: s }
    } catch {
      return { ok: false }
    }
  }, 20000)
  if (!(await state()).gate) return
  await cdp.eval(`(() => { const b = document.querySelector('.dialog-check input'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await sleep(250)
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('.dialog-actions button')].find((x) => x.textContent === '同意并继续'); b.click(); return true })()`)
  await waitFor('consent lifted', async () => {
    try {
      return { ok: (await cdp.eval(`document.querySelector('.app-shell') != null`)) === true }
    } catch {
      return { ok: false }
    }
  }, 15000)
}

/** Click helpers shared by the mode handlers. */
const clickTab = (cdp, label) =>
  cdp.eval(`(() => { const b = [...document.querySelectorAll('.tabs button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b == null) return false; b.click(); return true })()`)
const goHome = (cdp) => cdp.eval(`(() => { document.querySelector('.brand')?.click(); return true })()`)
const clickByText = (cdp, selector, label) =>
  cdp.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b == null) return false; b.click(); return true })()`)

/** Scroll an element into view inside whichever ancestor actually scrolls. */
const scrollToSel = (cdp, selector, offset) =>
  cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (el == null) return false
    let sc = el.parentElement
    while (sc != null && sc !== document.body) {
      const st = getComputedStyle(sc)
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && sc.scrollHeight > sc.clientHeight + 4) break
      sc = sc.parentElement
    }
    if (sc == null || sc === document.body) { el.scrollIntoView({ block: 'center' }); return true }
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - ${offset}
    return true
  })()`)

/** Expand courses until a lesson that already has a note (badge.ok) is selected. */
async function selectNotedLesson(cdp) {
  let clicked = false
  for (let i = 0; i < 30 && !clicked; i++) {
    const step = await cdp.eval(`(() => {
      if (window.__probeHeadIdx == null) window.__probeHeadIdx = 0
      const heads = [...document.querySelectorAll('.sidebar .course-head')]
      for (const h of heads) if (h.getAttribute('aria-expanded') === 'true' && heads.indexOf(h) !== window.__probeHeadIdx) h.click()
      const head = heads[window.__probeHeadIdx]
      if (head == null) return 'exhausted'
      if (head.getAttribute('aria-expanded') !== 'true') head.click()
      return 'ok'
    })()`)
    if (step === 'exhausted') break
    await sleep(250)
    clicked = (await cdp.eval(`(() => { const n = document.querySelector('.sidebar .lesson-row:not(.empty) .badge.ok'); if (n != null) { n.closest('.lesson-row').click(); return true } return false })()`)) === true
    if (!clicked) {
      await cdp.eval(`window.__probeHeadIdx = (window.__probeHeadIdx ?? 0) + 1`)
      await sleep(150)
    }
  }
  await sleep(1200)
  return clicked
}

/** 空库首启：侧栏引导卡 + 主区首启卡。 */
async function probeFirstRun(cdp, out) {
  out.initial = await cdp.json(MEASURE)
  await clickTab(cdp, '笔记')
  await sleep(900)
  out.emptyNoteTab = await cdp.json(MEASURE)
  await clickTab(cdp, '追问')
  await sleep(600)
  out.emptyQaTab = await cdp.json(MEASURE)
  if (!has('--shot')) return
  await clickTab(cdp, '任务')
  await sleep(700)
  await cdp.shot(join(ROOT, '.ui-shots', 'empty', 'welcome-tasks.png'))
  await cdp.setViewport(960, 600)
  await cdp.shot(join(ROOT, '.ui-shots', 'empty', 'welcome-tasks-960.png'))
  await cdp.clearViewport()
}

/** 三个页面各量一次（笔记 / 追问 / 任务）。 */
async function probeMainPages(cdp, out) {
  await selectNotedLesson(cdp)
  out.notePage = await cdp.json(MEASURE)
  await clickTab(cdp, '追问')
  await sleep(700)
  out.qaPage = await cdp.json(MEASURE)
  await goHome(cdp)
  await sleep(500)
  await clickTab(cdp, '任务')
  await sleep(900)
  out.tasksPage = await cdp.json(MEASURE)
}

/** 升级旧笔记弹层：列表是否顶出弹窗外框（批2 T5）。 */
async function probeUpgradeDialog(cdp, out) {
  await clickTab(cdp, '笔记')
  await sleep(900)
  const opened = await clickByText(cdp, '.note-library-actions button', '升级旧笔记')
  if (opened !== true) {
    out.upgradeDialog = 'no upgrade button on the library view'
    return
  }
  await waitFor('upgrade dialog', async () => {
    try {
      return { ok: (await cdp.eval(`document.querySelector('.note-upgrade-list') != null`)) === true }
    } catch {
      return { ok: false }
    }
  }, 8000)
  await sleep(500)
  out.upgradeDialog = await cdp.json(MEASURE)
  await clickByText(cdp, '.dialog-actions button', '取消')
  await sleep(400)
}

/** 长文本弹层在矮窗口下的钳制与滚动（批5 T36）。 */
async function probeLongDialog(cdp, out) {
  await cdp.setViewport(960, 600)
  await goHome(cdp)
  await sleep(400)
  await clickTab(cdp, '设置')
  await sleep(900)
  await scrollToSel(cdp, '[data-testid="about-panel"]', 80)
  await sleep(400)
  await clickByText(cdp, '[data-testid="about-panel"] button', '第三方许可')
  await sleep(700)
  out.longDialog = await cdp.json(`(() => {
    const d = document.querySelector('.dialog')
    if (d == null) return { opened: false }
    const r = d.getBoundingClientRect()
    const body = document.querySelector('.dialog-body')
    const sc = document.querySelector('.legal-scroll')
    return { opened: true, vh: innerHeight, dialogH: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), fitsH: r.top >= 0 && r.bottom <= innerHeight, maxH: getComputedStyle(d).maxHeight, bodyScrolls: body != null && body.scrollHeight > body.clientHeight + 1, legalOwnScroll: sc != null && getComputedStyle(sc).overflowY === 'auto' }
  })()`)
  await cdp.clearViewport()
}

/** 绑定能力复选框组的布局（批1 T30）。 */
async function probeProvider(cdp, out) {
  await goHome(cdp)
  await sleep(400)
  await clickTab(cdp, '设置')
  await sleep(900)
  await scrollToSel(cdp, '.capability-group', 120)
  await sleep(500)
  out.provider = await cdp.json(`(() => {
    const g = document.querySelector('.capability-group')
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }
    if (g == null) return { found: false }
    return { found: true, group: box(g), display: getComputedStyle(g).display, wrap: getComputedStyle(g).flexWrap, gap: getComputedStyle(g).gap, checks: [...g.children].map((c) => ({ text: c.textContent.trim(), ...box(c) })) }
  })()`)
  await cdp.shot(join(ROOT, '.ui-shots', 'provider', 'capability.png'))
}

/**
 * 笔记库分页（批C 批3）：首屏行数 → 「显示更多」文案 → 点击后行数。
 * 用 --seed-notes=N 把列表撑到页长以上才看得到按钮。
 */
async function probePaging(cdp, out) {
  await goHome(cdp)
  await sleep(500)
  await clickTab(cdp, '笔记')
  await sleep(1200)
  const read = () =>
    cdp.json(`(() => {
      const more = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('显示更多'))
      return { rows: document.querySelectorAll('[data-testid="note-library-row"]').length, more: more == null ? null : more.textContent.trim(), heading: document.querySelector('.subheading')?.textContent ?? '' }
    })()`)
  out.pagingBefore = await read()
  const clicked = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('显示更多')); if (b == null) return false; b.click(); return true })()`)
  if (clicked === true) {
    await sleep(1200)
    out.pagingAfter = await read()
  }
}

/** 笔记库搜索（批C 批2）：输入关键词 → 主进程过滤 → 标题/行数/分组。 */
async function probeNoteSearch(cdp, out, keyword) {
  await goHome(cdp)
  await sleep(500)
  await clickTab(cdp, '笔记')
  await sleep(900)
  const before = await cdp.json(`(() => ({ heading: document.querySelector('.subheading')?.textContent ?? '', rows: document.querySelectorAll('[data-testid="note-library-row"]').length, groups: document.querySelectorAll('.note-library-group').length }))()`)
  const focused = await cdp.eval(`(() => { const el = document.querySelector('.note-library-search'); if (el == null) return false; el.focus(); return true })()`)
  if (focused !== true) {
    out.noteSearch = { error: 'no search box on the library view' }
    return
  }
  // 真实浏览器输入路径（合成 value 写不进受控组件）。
  await cdp.send('Input.insertText', { text: keyword })
  await sleep(900)
  out.noteSearch = await cdp.json(`(() => ({ keyword: ${JSON.stringify(keyword)}, before: ${JSON.stringify(before)}, heading: document.querySelector('.subheading')?.textContent ?? '', rows: document.querySelectorAll('[data-testid="note-library-row"]').length, groups: document.querySelectorAll('.note-library-group').length, empty: document.querySelector('.note-library .msg')?.textContent ?? null }))()`)
  await cdp.shot(join(ROOT, '.ui-shots', 'note-search', 'filtered.png'))
}

/** 导图缩放几何。 */
const MINDMAP_GEOMETRY = `(() => {
  const sc = document.querySelector('.mindmap-scroll')
  const svg = document.querySelector('.mindmap-scroll svg')
  if (sc == null || svg == null) return { found: false }
  const w = Number(svg.getAttribute('width'))
  const h = Number(svg.getAttribute('height'))
  const vb = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number)
  const scale = w / vb[2]
  return { found: true, scale, scrollW: sc.clientWidth, scrollH: sc.clientHeight, svgW: w, svgH: h, drawnW: Math.round(w * scale), drawnH: Math.round(h * scale), fits: w * scale <= sc.clientWidth + 1 && h * scale <= sc.clientHeight + 1 }
})()`

/** 导图三态：首屏适应 / 放大后适应 / 窄窗适应（批3 T15）。 */
async function probeMindmap(cdp, out) {
  await selectNotedLesson(cdp)
  await clickTab(cdp, '笔记')
  await sleep(600)
  await clickByText(cdp, '.note-tabs button', '思维导图')
  await sleep(1500)
  out.mindmap = await cdp.json(MINDMAP_GEOMETRY)
  await cdp.eval(`(() => { const c = document.querySelector('.mindmap-scroll'); c.focus(); for (let i = 0; i < 3; i++) c.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })); return true })()`)
  await sleep(400)
  out.mindmapZoomed = await cdp.json(MINDMAP_GEOMETRY)
  await clickByText(cdp, '.mindmap-toolbar button', '适应窗口')
  await sleep(500)
  out.mindmapRefit = await cdp.json(MINDMAP_GEOMETRY)
  await cdp.setViewport(960, 600)
  await clickByText(cdp, '.mindmap-toolbar button', '适应窗口')
  await sleep(500)
  out.mindmapNarrow = await cdp.json(MINDMAP_GEOMETRY)
  await cdp.clearViewport()
  await cdp.shot(join(ROOT, '.ui-shots', 'mindmap', 'fitted.png'))
}

/** 窄窗（Emulation 覆盖视口）下的笔记页与任务页。 */
async function probeNarrow(cdp, out) {
  await cdp.setViewport(NARROW, 600)
  await selectNotedLesson(cdp)
  await clickTab(cdp, '笔记')
  await sleep(800)
  out.narrowNote = await cdp.json(MEASURE)
  await goHome(cdp)
  await sleep(500)
  await clickTab(cdp, '任务')
  await sleep(900)
  out.narrowTasks = await cdp.json(MEASURE)
  await cdp.clearViewport()
}

const one = (v) => (v == null ? '—' : String(v))

/** 终端摘要：只打关键数字，完整 JSON 在 OUT_FILE。 */
function summarize(out) {
  const lines = []
  const page = out.narrowNote ?? out.notePage ?? out.initial
  if (page != null) {
    const vp = page.viewport
    lines.push(`视口 ${vp.w}×${vp.h} · 内容盒 ${one(page.content?.w)} · 正文列 ${one(page.noteBody?.w)} · 题头 ${one(page.masthead?.w)}`)
    if (page.firstPara != null) lines.push(`正文 ${page.firstPara.fs}px / 行高 ${page.firstPara.lh} → ${page.firstPara.cjkPerLine} 全角字/行`)
    if (page.noteTitleInfo != null) lines.push(`题头标题 ${page.noteTitleInfo.fs}（${page.noteTitleInfo.len} 字 · ${page.noteTitleInfo.cls}）`)
    if (page.noteBtnCount > 0) lines.push(`工具行 ${page.noteBtnCount} 键 · ${page.actionsRows} 行 · 单键高 ${page.noteBtnBoxes[0]?.h} · 横向溢出 ${one(page.contentOverflowX)}`)
    if (page.countHeights?.length > 0) lines.push(`计数药丸高度 ${[...new Set(page.countHeights)].join('/')}`)
    if (page.subheadings?.length > 0) lines.push(`小标题 ${page.subheadings.join(' | ')}`)
  }
  const welcome = out.initial?.welcome
  if (welcome != null) {
    lines.push(`首启按钮 ${welcome.btns.map((b) => `${b.w}×${b.h}`).join(' / ')}`)
    lines.push(`主区首启卡 ${out.initial.emptyCards?.map((c) => `${c[0].split(' ')[0]} ${c[2]}×${c[3]}`).join(' · ')}`)
  }
  if (out.pagingBefore != null) {
    lines.push(`笔记库分页：首屏 ${out.pagingBefore.rows} 行 · 按钮「${out.pagingBefore.more ?? '无'}」· 标题「${out.pagingBefore.heading}」`)
    if (out.pagingAfter != null) lines.push(`点「显示更多」后 ${out.pagingAfter.rows} 行 · 按钮「${out.pagingAfter.more ?? '无'}」`)
  }
  if (out.noteSearch != null) {
    const n = out.noteSearch
    if (n.error != null) lines.push(`笔记搜索：${n.error}`)
    else lines.push(`笔记搜索「${n.keyword}」→ 标题「${n.heading}」· 行 ${n.before?.rows}→${n.rows} · 分组 ${n.before?.groups}→${n.groups}${n.empty != null ? ` · 空态「${n.empty}」` : ''}`)
  }
  if (out.tasksPage != null) {
    const cols = (page) => page.history.map((r) => `${one(r.errW)}${r.timeHidden ? '(时间收起)' : ''}`).join('/')
    const times = out.tasksPage.history.map((r) => r.timeW)
    lines.push(`任务行时间列 ${times.every((t) => t == null) ? '未渲染' : times.join('/')}`)
    lines.push(`任务行失败原因列（宽窗）${cols(out.tasksPage)}`)
    if (out.narrowTasks != null) lines.push(`任务行失败原因列（窄窗）${cols(out.narrowTasks)}`)
  }
  if (out.upgradeDialog != null && typeof out.upgradeDialog === 'object') {
    const u = out.upgradeDialog.upgradeList
    if (u != null) lines.push(`升级弹层 ${u.dialogW}×${u.dialogH} · 列表溢出 ${u.overflowPx}px · 视口内 ${u.fitsH}`)
  }
  if (out.longDialog?.opened === true) {
    lines.push(`长文本弹层 max-height ${out.longDialog.maxH} · 高 ${out.longDialog.dialogH} · 视口内 ${out.longDialog.fitsH} · 内部滚动 ${out.longDialog.bodyScrolls}`)
  }
  if (out.provider?.found === true) {
    lines.push(`能力复选框组 ${out.provider.display} · gap ${out.provider.gap} · ${out.provider.checks.map((c) => `${c.text} ${c.w}×${c.h}`).join(' / ')}`)
  }
  for (const [key, label] of [['mindmap', '导图首屏'], ['mindmapZoomed', '放大后'], ['mindmapRefit', '适应后'], ['mindmapNarrow', '窄窗适应']]) {
    const m = out[key]
    if (m?.found === true) lines.push(`${label} scale ${m.scale.toFixed(3)} · 画布 ${m.scrollW}×${m.scrollH} · 内容 ${m.svgW}×${m.svgH} → ${m.drawnW}×${m.drawnH} · 装得下 ${m.fits}`)
  }
  return lines
}

async function main() {
  const out = {}
  const tmpDocs = prepareLibrary()
  const seedArg = argOf('--seed-notes=')
  if (seedArg != null && !has('--empty')) seedNotes(join(tmpDocs, 'SEU Summary', 'Library', 'app.db'), Number(seedArg))
  const outMain = join(ROOT, 'out', 'main', 'index.cjs')
  if (!existsSync(outMain)) {
    console.error('out/main/index.cjs missing — run `npm run build` first')
    process.exit(1)
  }
  const port = await findFreePort(9700 + Math.floor(Math.random() * 200))
  const electron = spawn(require('electron'), ['.', `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    env: { ...process.env, SEU_SUMMARY_DOCS_OVERRIDE: tmpDocs, ELECTRON_RENDERER_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  electron.stderr.on('data', () => {})
  try {
    const cdp = await connect(port)
    await passConsentGate(cdp)
    await sleep(1500)
    await cdp.eval(`document.documentElement.dataset.theme = 'light'`)
    if (has('--empty')) {
      await probeFirstRun(cdp, out)
    } else {
      await probeMainPages(cdp, out)
      await probeUpgradeDialog(cdp, out)
      if (has('--dialog')) await probeLongDialog(cdp, out)
      if (has('--provider')) await probeProvider(cdp, out)
      if (has('--mindmap')) await probeMindmap(cdp, out)
      if (argOf('--note-search=') != null) await probeNoteSearch(cdp, out, argOf('--note-search='))
      if (has('--paging')) await probePaging(cdp, out)
      if (NARROW != null) await probeNarrow(cdp, out)
    }
  } finally {
    if (electron.pid != null) {
      try {
        execFileSync('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        /* already gone */
      }
    }
    for (let i = 0; i < 8; i++) {
      try {
        rmSync(tmpDocs, { recursive: true, force: true })
        break
      } catch {
        await sleep(400)
      }
    }
  }
  mkdirSync(join(OUT_FILE, '..'), { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 1))
  console.log(`\nui-probe → ${OUT_FILE}`)
  for (const line of summarize(out)) console.log(`  ${line}`)
}

await main()
