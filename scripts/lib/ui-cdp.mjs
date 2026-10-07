/**
 * Shared CDP/walk helpers for the dev UI tooling (screenshot & probe scripts).
 *
 * Extracted from scripts/ui-shots.mjs (2026-10-06, README screenshot pipeline) —
 * the boot/connect/gate-walk pieces were copy-pasted between ui-shots and
 * ui-probe; this module is the single implementation. Behavior is unchanged
 * for the callers: same waits, same clicks, same selectors.
 *
 * Isolation seams every caller relies on (never touch the real Library or the
 * installed app's userData):
 *   SEU_SUMMARY_DOCS_OVERRIDE  → throwaway docs root (copy of app.db, plus
 *                                 attachments/ when note images are needed)
 *   ELECTRON_RENDERER_URL=''   → load the built renderer from out/
 *   SEU_PDF_PATH / …           → per-call dev-only export overrides (main side)
 */
import { spawn, execFileSync } from 'child_process'
import { createServer } from 'http'
import { setTimeout, clearTimeout } from 'node:timers'
import { mkdirSync, mkdtempSync, copyFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
export const ROOT = join(import.meta.dirname, '..', '..')
export const APP_TITLE = 'Flash Summary'
export const REAL_LIBRARY = join(homedir(), 'Documents', 'SEU Summary', 'Library')

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const has = (flag) => process.argv.includes(flag)
export const argOf = (prefix) => {
  const found = process.argv.find((a) => a.startsWith(prefix))
  return found == null ? null : found.slice(prefix.length)
}

/** Await a predicate with a deadline; throws with the last observation. */
export async function waitFor(label, predicate, timeoutMs, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await predicate()
    if (last.ok) return last.value
    await sleep(intervalMs)
  }
  throw new Error(`${label} not reached within ${timeoutMs}ms (last: ${JSON.stringify(last?.value ?? null)})`)
}

/** Minimal CDP client over the DevTools WebSocket. */
export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id == null || !this.pending.has(msg.id)) return
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error != null) reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`))
      else resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /**
   * send() with a client-side deadline. On timeout the pending entry is
   * DROPPED, so a late response finds no waiter and is ignored — the socket
   * stays usable. (2026-10-07: Page.captureScreenshot can sit unanswered for
   * a long time right after the shot window is un-hidden; without a deadline
   * the whole run hangs forever.)
   */
  sendWithTimeout(method, params = {}, timeoutMs) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /**
   * Page.captureScreenshot with abandoned-timeout retries. The first capture
   * after a hidden→visible window transition can take a long time to produce
   * a frame; dropping the timed-out request and retrying gets one normally.
   */
  async captureWithRetry(params, { attempts = 3, timeoutMs = 10000 } = {}) {
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.sendWithTimeout('Page.captureScreenshot', params, timeoutMs)
      } catch (e) {
        lastError = e
      }
    }
    throw lastError ?? new Error('capture failed')
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    })
    if (result.exceptionDetails != null) {
      const desc = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(`evaluate threw: ${desc}`)
    }
    return result.result?.value
  }

  async json(expression) {
    return JSON.parse(await this.eval(`JSON.stringify(${expression})`))
  }

  async shot(path) {
    mkdirSync(join(path, '..'), { recursive: true })
    const { data } = await this.captureWithRetry({ format: 'png' })
    const { writeFileSync } = await import('fs')
    writeFileSync(path, Buffer.from(data, 'base64'))
    console.log(`shot  ${path}`)
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

export function findFreePort(start) {
  return new Promise((resolve) => {
    const probe = (port) => {
      const server = createServer()
      server.once('error', () => probe(port + 1))
      server.once('listening', () => server.close(() => resolve(port)))
      server.listen(port, '127.0.0.1')
    }
    probe(start)
  })
}

/** Spawn the built app and return { electron, port } (CDP not yet connected). */
export async function spawnApp(tmpDocs, extraEnv = {}) {
  const port = await findFreePort(9500 + Math.floor(Math.random() * 400))
  // stdio must NOT be a pipe nobody reads: the app fills the 64KB buffer and
  // then blocks on write — the window stops responding to SetWindowPos and
  // every zoom/resize measurement silently drifts (2026-09-21 lesson).
  const electron = spawn(require('electron'), ['.', `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    env: { ...process.env, SEU_SUMMARY_DOCS_OVERRIDE: tmpDocs, ELECTRON_RENDERER_URL: '', ...extraEnv },
    stdio: 'ignore'
  })
  return { electron, port }
}

export async function connect(port, timeoutMs = 30000) {
  const target = await waitFor(
    'main window target',
    async () => {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const match = list.find((t) => t.type === 'page' && t.title.includes(APP_TITLE))
        return { ok: match != null, value: match }
      } catch {
        return { ok: false }
      }
    },
    timeoutMs
  )
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket connect failed')), { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  return cdp
}

/** A library without recorded consent stops at the 使用须知 gate. */
export async function waitForShell(cdp, timeoutMs = 20000) {
  const state = () => cdp.json(`({ gate: document.querySelector('[data-testid="consent-clauses"]') != null, shell: document.querySelector('.app-shell') != null })`)
  await waitFor(
    'shell or consent gate',
    async () => {
      try {
        const parsed = await state()
        return { ok: parsed.gate === true || parsed.shell === true, value: parsed }
      } catch {
        return { ok: false }
      }
    },
    timeoutMs
  )
  return (await state()).gate === true ? 'gate' : 'shell'
}

/** Tick the consent box and accept (the gate must be on screen). */
export async function acceptConsentGate(cdp) {
  const ticked = await cdp.eval(`(() => {
    const box = document.querySelector('.dialog-check input')
    if (box == null) return false
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  if (ticked !== true) throw new Error('consent checkbox not found')
  // Preact re-renders on a microtask: in the same synchronous block the confirm
  // button is still disabled and the click would be swallowed.
  await sleep(250)
  const accepted = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('.dialog-actions button')].find((b) => b.textContent === '同意并继续')
    if (btn == null || btn.disabled) return false
    btn.click()
    return true
  })()`)
  if (accepted !== true) throw new Error('consent accept click failed')
  await waitFor(
    'consent lifted',
    async () => {
      try {
        return { ok: (await cdp.eval('document.querySelector(".app-shell") != null')) === true }
      } catch {
        return { ok: false }
      }
    },
    15000
  )
}

/** Gate + shell in one call: returns 'gate' | 'shell' (and walks the gate). */
export async function passConsentGate(cdp) {
  const state = await waitForShell(cdp)
  if (state === 'gate') await acceptConsentGate(cdp)
  return state
}

/** Click helpers shared by the mode handlers. */
export const clickTab = (cdp, label) =>
  cdp.eval(`(() => { const b = [...document.querySelectorAll('.tabs button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b == null) return false; b.click(); return true })()`)
export const goHome = (cdp) => cdp.eval(`(() => { document.querySelector('.brand')?.click(); return true })()`)
export const clickByText = (cdp, selector, label) =>
  cdp.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (b == null) return false; b.click(); return true })()`)

/**
 * Expand courses until a lesson that already has a note (badge.ok) is selected.
 *  preferCover=true keeps walking the note library until the selection is a
 *  B站 lesson with a cover (.note-cover); SEU lessons legitimately have none.
 */
export async function selectNotedLesson(cdp, { preferCover = false } = {}) {
  let clicked = false
  for (let attempt = 0; attempt < 30 && !clicked; attempt++) {
    const stepped = await cdp.eval(`(() => {
      if (window.__selectHeadIdx == null) window.__selectHeadIdx = 0
      const heads = [...document.querySelectorAll('.sidebar .course-head')]
      for (const h of heads) {
        if (h.getAttribute('aria-expanded') === 'true' && heads.indexOf(h) !== window.__selectHeadIdx) h.click()
      }
      const head = heads[window.__selectHeadIdx]
      if (head == null) return 'exhausted'
      if (head.getAttribute('aria-expanded') !== 'true') head.click()
      return 'ok'
    })()`)
    if (stepped === 'exhausted') break
    await sleep(250)
    clicked =
      (await cdp.eval(`(() => {
        const noted = document.querySelector('.sidebar .lesson-row:not(.empty) .badge.ok')
        if (noted != null) { noted.closest('.lesson-row').click(); return true }
        return false
      })()`)) === true
    if (!clicked) {
      await cdp.eval('window.__selectHeadIdx = (window.__selectHeadIdx ?? 0) + 1')
      await sleep(150)
    }
  }
  await sleep(1200)
  if (clicked && preferCover) {
    // The sidebar hides cross-course lessons; the note library lists every
    // noted lesson, so walk its rows until one with a cover is selected.
    let rowCount = -1
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await cdp.eval(`(() => document.querySelector('.note-cover') != null)()`)) === true) break
      if (rowCount >= 0 && attempt >= rowCount) break
      await goHome(cdp)
      await sleep(400)
      if ((await clickTab(cdp, '笔记')) !== true) break
      await sleep(800)
      if (rowCount < 0) {
        rowCount = (await cdp.eval(`(() => document.querySelectorAll('[data-testid="note-library-row"]').length)()`)) || 0
      }
      if (rowCount === 0) break
      await cdp.eval(`(() => { const rows = [...document.querySelectorAll('[data-testid="note-library-row"]')]; rows[${attempt % rowCount}].click(); return true })()`)
      await sleep(1000)
    }
  }
  return clicked
}

/**
 * P28 (plan 2026-09-21): really resize the OS window (Electron 44 has no
 * Browser.setWindowBounds; CDP -32601 in practice → PowerShell + user32).
 * EnumWindows over ALL top-level windows — a crashed leftover instance holds
 * the same title, and the GW_HWNDNEXT chain is unreliable (misses windows
 * before the start). SW_RESTORE first: SetWindowPos on a minimized window
 * returns True without resizing.
 *
 * 2026-10-07 (plan 2026-10-07 收尾): `pid` scopes the enum to the spawned
 * instance's window. Title-only matching also hits the user's LIVE app (same
 * product title): every run moved their window to 60,60 1920×1200, and the
 * shared window-bounds state raced the pin — the dev window was pinned and
 * then shrunk back by its own bounds restore, leaving the CSS viewport at
 * 1063 (`window pin failed`, three runs in a row). Callers that omit pid
 * keep the old title-wide behavior.
 */
function osWindowScript(body, pid = null) {
  const pidFilter =
    pid == null
      ? ''
      : `
  $procId = 0
  [void]$t::GetWindowThreadProcessId($h, [ref]$procId)
  if ($procId -ne ${pid}) { return $true }`
  return `
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WE {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint procId);
}
'@
$t = @(Add-Type -TypeDefinition $src -PassThru | Where-Object { $_.Name -eq 'WE' })[0]
$script:found = 0
$cb = {
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 256
  [void]$t::GetWindowText($h, $sb, 256)
  if ($sb.ToString() -eq '${APP_TITLE}') {${pidFilter}
    $script:found++
    [void]$t::ShowWindow($h, 9)
    ${body}
  }
  return $true
}
[void]$t::EnumWindows($cb, [IntPtr]::Zero)
if ($script:found -eq 0) { exit 2 }
`
}

export function screenWidth() {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width'], { encoding: 'latin1' })
  return Number(String(out).trim()) || 1920
}

/** Primary screen size (physical px) — the target for a screen-filling shot window. */
export function screenSize() {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "$($b.Width)x$($b.Height)"'],
    { encoding: 'latin1' }
  )
  const [w, h] = String(out).trim().split('x').map(Number)
  return { width: w || 1920, height: h || 1200 }
}

export function setOsWindowSize(width, height, pid = null, x = 60, y = 60) {
  execFileSync('powershell', ['-NoProfile', '-Command', osWindowScript(`$t::SetWindowPos($h, [IntPtr]::Zero, ${x}, ${y}, ${width}, ${height}, 0) | Out-Null`, pid)], { stdio: 'pipe' })
}

/**
 * SW_RESTORE (9) the pid-scoped window so it is actually visible and its
 * compositor produces frames — `Page.captureScreenshot` waits for one and
 * hangs forever on a window that was created hidden (SEU_SMOKE show:false).
 * 2026-10-07 field-verified: hidden → shot hangs; SW_RESTORE → shot OK;
 * SW_MAXIMIZE after a hidden start → shot STILL hangs, so the window is
 * screen-filled with SetWindowPos instead (below).
 */
export function restoreOsWindow(pid = null) {
  execFileSync('powershell', ['-NoProfile', '-Command', osWindowScript('[void]$t::ShowWindow($h, 9)', pid)], { stdio: 'pipe' })
}

/**
 * Throwaway docs root for one run. withAttachments copies the 24MB
 * attachments/ tree too — note timeline images/cover are loaded from there,
 * so note-view shots are image-less without it.
 */
export function prepareThrowawayDocs({ withAttachments = false, empty = false } = {}) {
  const tmpDocs = mkdtempSync(join(tmpdir(), 'seu-ui-'))
  if (empty) return tmpDocs
  const tmpLib = join(tmpDocs, 'SEU Summary', 'Library')
  mkdirSync(tmpLib, { recursive: true })
  for (const file of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const src = join(REAL_LIBRARY, file)
    if (existsSync(src)) copyFileSync(src, join(tmpLib, file))
  }
  if (withAttachments) {
    const attachments = join(REAL_LIBRARY, 'attachments')
    if (existsSync(attachments)) {
      const { cpSync } = require('fs')
      cpSync(attachments, join(tmpLib, 'attachments'), { recursive: true })
    }
  }
  return tmpDocs
}

/**
 * Throwaway userData holding ONLY the encrypted credential material, so a
 * README run renders the logged-in shell (2026-10-07: the -dev userData
 * carries a stale school session, which hides the new semester selector
 * from every sidebar shot). Copies `Local State` (the os_crypt key that
 * seals both session.bin files) + `school-session/session.bin` +
 * `bilibili-session/session.bin` — nothing else: no cache, no logs, no
 * provider vault. The B站 session matters too: without it the import dialog
 * parks on the QR-login state and the running station (which imports a real
 * public video) finds no import button. The copy lives in %TEMP% and the
 * caller removes it in `finally`; credentials never enter the repo and
 * never leave the machine.
 */
export function prepareThrowawayUserData() {
  const src = join(process.env.APPDATA || '', 'seu-summary')
  const dst = mkdtempSync(join(tmpdir(), 'seu-ui-udata-'))
  const localState = join(src, 'Local State')
  if (existsSync(localState)) copyFileSync(localState, join(dst, 'Local State'))
  for (const dir of ['school-session', 'bilibili-session']) {
    const from = join(src, dir)
    if (!existsSync(from)) continue
    mkdirSync(join(dst, dir), { recursive: true })
    for (const file of ['session.bin']) {
      const src2 = join(from, file)
      if (existsSync(src2)) copyFileSync(src2, join(dst, dir, file))
    }
  }
  return dst
}

export function killApp(electron) {
  if (electron.pid == null) return
  try {
    execFileSync('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* already gone */
  }
}

export async function removeDir(dir) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await sleep(500)
    }
  }
}
