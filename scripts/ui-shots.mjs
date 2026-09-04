/**
 * UI screenshot harness (dev tool for the visual overhaul): boots the real
 * built app against a THROWAWAY COPY of the real library db (never the real
 * files), then walks the main views over CDP and saves PNGs.
 *
 *   node scripts/ui-shots.mjs [outDir] [--prefix=name]
 *
 * Library isolation: copies app.db(-wal/-shm) into a temp dir and points
 * SEU_SUMMARY_DOCS_OVERRIDE at it — the running installed app and the real
 * Library are never touched. userData stays the normal `-dev` one.
 * Requires Node >= 22 (native WebSocket/fetch) and a fresh `npm run build`.
 */
import { spawn, execFileSync } from 'child_process'
import { createServer } from 'http'
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const APP_TITLE = 'SEU Summary'
const REAL_LIBRARY = join(homedir(), 'Documents', 'SEU Summary', 'Library')

/** Await a predicate with a deadline; throws with the last observation. */
async function waitFor(label, predicate, timeoutMs, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await predicate()
    if (last.ok) return last.value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`${label} not reached within ${timeoutMs}ms (last: ${JSON.stringify(last?.value ?? null)})`)
}

/** Minimal CDP client over the DevTools WebSocket. */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error != null) reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`))
        else resolve(msg.result)
      }
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

  async shot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(data, 'base64'))
    console.log(`shot  ${path}`)
  }
}

function findFreePort(start) {
  return new Promise((resolve) => {
    const probe = (port) => {
      const s = createServer()
      s.once('error', () => probe(port + 1))
      s.once('listening', () => s.close(() => resolve(port)))
      s.listen(port, '127.0.0.1')
    }
    probe(start)
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const outDir = process.argv[2] != null && !process.argv[2].startsWith('--') ? process.argv[2] : join(ROOT, '.ui-shots')
  const prefixArg = process.argv.find((a) => a.startsWith('--prefix='))
  const prefix = prefixArg != null ? prefixArg.slice('--prefix='.length) : ''
  mkdirSync(outDir, { recursive: true })
  const shotName = (name) => join(outDir, `${prefix}${name}.png`)

  // Throwaway library copy: the real db stays untouched (WAL-safe by copy).
  const tmpDocs = mkdtempSync(join(tmpdir(), 'seu-ui-docs-'))
  const tmpLib = join(tmpDocs, 'SEU Summary', 'Library')
  mkdirSync(tmpLib, { recursive: true })
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const src = join(REAL_LIBRARY, f)
    if (existsSync(src)) copyFileSync(src, join(tmpLib, f))
  }

  const outMain = join(ROOT, 'out', 'main', 'index.cjs')
  if (!existsSync(outMain)) {
    console.error('out/main/index.cjs missing — run `npm run build` first')
    process.exit(1)
  }

  const port = await findFreePort(9500 + Math.floor(Math.random() * 200))
  const electron = spawn(require('electron'), ['.', `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    env: { ...process.env, SEU_SUMMARY_DOCS_OVERRIDE: tmpDocs, ELECTRON_RENDERER_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  electron.stderr.on('data', (d) => process.stderr.write(String(d).slice(0, 400)))

  try {
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
      30000
    )
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket connect failed')), { once: true })
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')

    await waitFor('bridge + course tree', async () => {
      try {
        const n = await cdp.eval('document.querySelectorAll(".sidebar .course-item").length')
        return { ok: typeof n === 'number' && n > 0, value: n }
      } catch {
        return { ok: false }
      }
    }, 20000)

    // --light / --dark: pin the theme via DOM override (auto follows the OS).
    if (process.argv.includes('--light')) {
      await cdp.eval('document.documentElement.dataset.theme = "light"')
      await sleep(300)
    }
    if (process.argv.includes('--dark')) {
      await cdp.eval('document.documentElement.dataset.theme = "dark"')
      await sleep(300)
    }

    // 1. initial view (tasks tab, nothing selected)
    await sleep(400)
    await cdp.shot(shotName('01-tasks-initial'))

    // 2. expand the first course that has a lesson with a note (badge.ok), select that lesson
    // Two steps: the sidebar defaults to the «我的学习» panel whose course rows are collapsed;
    // click one course head at a time, wait for its lesson rows, check for a noted lesson.
    const expandCourseWithNotes = `(() => {
      const head = [...document.querySelectorAll('.sidebar .course-head')][0]
      if (head == null) return false
      head.click()
      return true
    })()`
    let notedClicked = false
    for (let attempt = 0; attempt < 30 && !notedClicked; attempt++) {
      await cdp.eval(expandCourseWithNotes)
      await sleep(250)
      notedClicked =
        (await cdp.eval(`(() => {
          const noted = document.querySelector('.sidebar .lesson-row:not(.empty) .badge.ok')
          if (noted != null) { noted.closest('.lesson-row').click(); return true }
          return false
        })()`)) === true
      if (!notedClicked) {
        // no noted lesson in the expanded course — try the next course head
        await cdp.eval(`(() => {
          const heads = [...document.querySelectorAll('.sidebar .course-head')]
          const open = heads.find((h) => h.getAttribute('aria-expanded') === 'true')
          const next = open != null ? heads[heads.indexOf(open) + 1] : heads[0]
          if (open != null) open.click() // collapse before moving on
          if (next != null) { next.click(); return true }
          return false
        })()`)
        await sleep(250)
      }
    }
    if (!notedClicked) throw new Error('no lesson with a note found in the sidebar')
    await sleep(1200)
    await cdp.shot(shotName('02-lesson-selected'))

    // 3. notes tab + its four views
    const goTab = (label) => cdp.eval(
      `(() => { const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b == null) return false; b.click(); return true })()`
    )
    const goNoteView = (label) => cdp.eval(
      `(() => { const b = [...document.querySelectorAll('.note-tabs button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b == null) return false; b.click(); return true })()`
    )
    await goTab('笔记')
    await sleep(900)
    await cdp.shot(shotName('03-note-detailed'))
    for (const label of ['标准总结', '要点', '方法论', '思维导图']) {
      const clicked = await goNoteView(label)
      if (clicked !== true) throw new Error(`note view tab not found: ${label}`)
      await sleep(500)
      await cdp.shot(shotName(`04-note-${label}`))
    }

    // 4. qa + settings
    await goTab('追问')
    await sleep(700)
    await cdp.shot(shotName('05-qa'))
    await goTab('设置')
    await sleep(700)
    await cdp.shot(shotName('06-settings'))

    // 5. dark theme (DOM override only — never persisted)
    await cdp.eval('document.documentElement.dataset.theme = "dark"')
    await sleep(500)
    await cdp.shot(shotName('07-dark-settings'))
    await goTab('笔记')
    await goNoteView('详细笔记')
    await sleep(600)
    await cdp.shot(shotName('08-dark-note'))
    await goTab('任务')
    await sleep(500)
    await cdp.shot(shotName('09-dark-tasks'))
    await cdp.eval('delete document.documentElement.dataset.theme')
  } finally {
    if (electron.pid != null) {
      try {
        execFileSync('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        // already gone
      }
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        rmSync(tmpDocs, { recursive: true, force: true })
        break
      } catch {
        await sleep(500)
      }
    }
  }
  console.log(`\nDONE → ${outDir}`)
}

await main()
