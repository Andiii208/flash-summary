/**
 * CDP smoke probe: boots the real built app (`out/main/index.cjs`) in a
 * throwaway userData + library, then asserts the combined-process contract
 * that unit tests cannot see:
 *
 *   L1  bridge surface   — window.seuSummary groups/methods vs bridge.ts
 *   L1  IPC liveness     — every side-effect-free channel invoke round-trips
 *                          an ApiResult envelope (incl. two error paths)
 *   L4  startup assembly — library layout + app.db migrations really happen
 *   L4  file logging     — log:rendererError reaches the redacted file log
 *   L4  first render     — tabs + session badge start as logged_out
 *
 * Isolation: SEU_SMOKE_USER_DATA redirects Electron userData (session blob,
 * logs, single-instance lock); SEU_SUMMARY_DOCS_OVERRIDE redirects the
 * library root (paths.ts). The probe never touches the real user data.
 *
 * Requires Node >= 22 (native WebSocket/fetch). Run via `npm run smoke`.
 * Deliberately NOT probed over the wire: school:listCourses (hits the real
 * school API) and school:login (opens the CAS window).
 */
import { spawn, execFileSync } from 'child_process'
import { createServer } from 'http'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const APP_TITLE = 'Flash Summary'
const PROBE_LOG_LINE = 'renderer: smoke-probe-line'

/** @returns {Array<{name: string, pass: boolean, detail: string}>} */
const results = []
function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
}

function failFast(message) {
  console.error(`SMOKE FATAL: ${message}`)
  process.exit(1)
}

/** Await a predicate with a deadline; throws with the last observation. */
async function waitFor(label, predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  let last
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

  /** Runtime.evaluate with promise awaiting; returns the plain value. */
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
}

function readAllLogs(logsDir) {
  if (!existsSync(logsDir)) return ''
  return readdirSync(logsDir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => readFileSync(join(logsDir, f), 'utf8'))
    .join('\n')
}

/** First port at or after `start` that nothing is listening on. */
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

/** Expected bridge surface — keep in sync with src/shared/bridge.ts. */
const EXPECTED_BRIDGE = {
  school: ['login', 'logout', 'session', 'listCourses', 'onRefreshProgress', 'addManualCourse', 'courseTree', 'harvestLessons', 'harvestState', 'removeCourse', 'netCheck', 'setMine'],
  bilibili: ['login', 'loginStatus', 'logout', 'session', 'resolve', 'import'],
  providers: ['list', 'save', 'remove', 'bind', 'test'],
  tasks: ['create', 'list', 'runAsync', 'cancel', 'remove', 'clearFinished', 'onProgress'],
  notes: ['latest', 'list', 'courseHealth', 'exportMarkdown', 'exportObsidian', 'exportCourseObsidian', 'exportAnki', 'exportSvg', 'courseTree', 'attachments', 'attachmentData', 'regenerate', 'polish', 'exportPdfDialog', 'exportPdfWrite', 'revealFile'],
  qa: ['ask', 'history', 'recent'],
  settings: ['get', 'setCacheDir', 'chooseCacheDir', 'setTheme', 'chooseLibrary', 'openPath', 'acceptDisclaimer', 'optOutCopyrightNotice', 'onMigrateProgress'],
  log: ['rendererError'],
  feedback: ['openForm', 'diagnostics']
}

// Ipc probes: channel, expression returning the envelope, and a predicate.
// Two error paths (unknown capability, FK violation on a missing lesson)
// assert the err() envelope reaches the renderer intact.
const PROBES = [
  ['school:session', 's.school.session()', (r) => r.ok === true && r.value?.state === 'logged_out'],
  ['school:courseTree', 's.school.courseTree()', (r) => r.ok === true && Array.isArray(r.value) && r.value.length === 0],
  ['providers:list', 's.providers.list()', (r) => r.ok === true && Array.isArray(r.value?.providers) && Array.isArray(r.value?.bindings)],
  ['settings:get', 's.settings.get()', (r) => r.ok === true && typeof r.value?.theme === 'string'],
  ['tasks:list', 's.tasks.list()', (r) => r.ok === true && Array.isArray(r.value)],
  ['tasks:cancel (missing)', "s.tasks.cancel('smoke-none')", (r) => r.ok === true && r.value?.cancelled === true],
  ['school:harvestState', 's.school.harvestState()', (r) => r.ok === true && Array.isArray(r.value?.inflight) && r.value.inflight.length === 0],
  ['notes:latest (missing)', "s.notes.latest('smoke-none')", (r) => r.ok === true && r.value === null],
  ['notes:list', 's.notes.list()', (r) => r.ok === true && Array.isArray(r.value)],
  ['notes:courseHealth (missing)', "s.notes.courseHealth('smoke-none')", (r) => r.ok === false && typeof r.error === 'string'],
  ['notes:exportObsidian (missing note)', "s.notes.exportObsidian('smoke-none')", (r) => r.ok === false && typeof r.error === 'string'],
  ['notes:exportCourseObsidian (missing)', "s.notes.exportCourseObsidian('smoke-none')", (r) => r.ok === false && typeof r.error === 'string'],
  ['notes:courseTree (missing)', "s.notes.courseTree('smoke-none')", (r) => r.ok === false && typeof r.error === 'string'],
  ['notes:polish (empty feedback)', "s.notes.polish('smoke-none', { tags: [], text: '' })", (r) => r.ok === false && typeof r.error === 'string'],
  ['notes:polish (missing note)', "s.notes.polish('smoke-none', { tags: ['too_brief'], text: '' })", (r) => r.ok === false && typeof r.error === 'string'],
  ['qa:recent', 's.qa.recent()', (r) => r.ok === true && Array.isArray(r.value)],
  ['qa:history (missing)', "s.qa.history('smoke-none')", (r) => r.ok === true && Array.isArray(r.value)],
  ['qa:ask (no binding)', "s.qa.ask('smoke-none', 'probe')", (r) => r.ok === false && typeof r.error === 'string'],
  ['providers:bind (bad capability)', "s.providers.bind('bogus', 'p', 'm')", (r) => r.ok === false && typeof r.error === 'string'],
  ['log:rendererError', `s.log.rendererError(${JSON.stringify(PROBE_LOG_LINE)})`, (r) => r.ok === true && r.value === true]
]

async function main() {
  const outMain = join(ROOT, 'out', 'main', 'index.cjs')
  if (!existsSync(outMain)) failFast('out/main/index.cjs missing — run `npm run build` first')

  const tmpDocs = mkdtempSync(join(tmpdir(), 'seu-smoke-docs-'))
  const tmpUserData = mkdtempSync(join(tmpdir(), 'seu-smoke-udata-'))
  const port = await findFreePort(9300 + Math.floor(Math.random() * 200))
  let electron = null

  try {
    const electronExe = require('electron')
    electron = spawn(electronExe, ['.', '--no-sandbox', `--remote-debugging-port=${port}`], {
      cwd: ROOT,
      env: {
        ...process.env,
        SEU_SMOKE: '1',
        SEU_SMOKE_USER_DATA: tmpUserData,
        SEU_SUMMARY_DOCS_OVERRIDE: tmpDocs,
        ELECTRON_RENDERER_URL: ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderrTail = ''
    electron.stderr.on('data', (d) => {
      stderrTail = (stderrTail + String(d)).slice(-4000)
    })
    electron.on('exit', (code) => {
      if (code != null && code !== 0 && results.length === 0) failFast(`electron exited early (code ${code})\n${stderrTail}`)
    })

    // Locate the main window target over the DevTools HTTP endpoint.
    const target = await waitFor(
      'main window target',
      async () => {
        try {
          const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
          // find() miss must read as "not yet" — {ok:true, value:undefined}
          // would short-circuit waitFor and crash on the WebSocket line.
          const hit = list.find((t) => t.type === 'page' && t.title.includes(APP_TITLE))
          return hit != null ? { ok: true, value: hit } : { ok: false }
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
    await cdp.send('Runtime.enable')

    // Wait for the preload bridge to be observable, then run all assertions.
    await waitFor('window.seuSummary bridge', async () => {
      try {
        return { ok: (await cdp.eval('typeof window.seuSummary')) === 'object' }
      } catch {
        return { ok: false }
      }
    }, 15000)

    // L1: bridge surface exactly matches the expected groups/methods.
    const actualBridge = await cdp.eval(
      'JSON.stringify(Object.fromEntries(Object.entries(window.seuSummary).map(([k, v]) => [k, Object.keys(v)])))'
    )
    const actualGroups = JSON.parse(actualBridge)
    const expectedGroups = JSON.stringify(EXPECTED_BRIDGE)
    const actualGroupsJson = JSON.stringify(actualGroups)
    record('L1 bridge surface matches bridge.ts', actualGroupsJson === expectedGroups, actualGroupsJson === expectedGroups ? '' : `actual ${actualGroupsJson}`)

    // L1: IPC liveness for every side-effect-free channel.
    const probeResults = await cdp.eval(
      `(async () => {
        const s = window.seuSummary
        const wrap = async (p) => { try { return await p } catch (e) { return { threw: String(e) } } }
        return JSON.stringify(await Promise.all([${PROBES.map(([, expr]) => `wrap(${expr})`).join(', ')}]))
      })()`
    )
    PROBES.forEach(([channel, , predicate], index) => {
      const envelope = JSON.parse(probeResults)[index]
      if (envelope?.threw != null) {
        record(`L1 ${channel}`, false, `renderer threw: ${envelope.threw}`)
        return
      }
      let pass = false
      try {
        pass = predicate(envelope) === true
      } catch {
        pass = false
      }
      record(`L1 ${channel}`, pass, pass ? '' : `envelope ${JSON.stringify(envelope)}`)
    })

    // L4: settings.get must resolve inside the isolated docs dir.
    const settingsEnvelope = JSON.parse(probeResults)[3]
    record(
      'L4 library isolated to smoke docs dir',
      typeof settingsEnvelope?.value?.libraryRoot === 'string' && settingsEnvelope.value.libraryRoot.startsWith(tmpDocs),
      `libraryRoot ${String(settingsEnvelope?.value?.libraryRoot)} vs tmp ${tmpDocs}`
    )

    // L4 (声明批2): a throwaway userData means no consent is recorded yet, so
    // the app must STOP at the 使用须知 gate instead of rendering the shell.
    // Drive the real UI (tick + accept) rather than calling the IPC directly —
    // this is the actual first-run path, preact state update included.
    const gate = JSON.parse(
      await cdp.eval(
        `JSON.stringify({
          clauses: document.querySelectorAll('[data-testid="consent-clauses"] p').length,
          shell: document.querySelector('.app-shell') != null
        })`
      )
    )
    record('L4 使用须知闸门拦在首启（未同意不渲染主界面）', gate.clauses === 9 && gate.shell === false, `clauses ${gate.clauses}, shell ${gate.shell}`)

    // Preact re-renders on a microtask, so the tick and the click must be two
    // separate evaluations: clicking «同意并继续» in the same synchronous block
    // hits the still-disabled button and silently does nothing.
    const beforeTick = JSON.parse(
      await cdp.eval(
        `(() => {
          const confirm = [...document.querySelectorAll('.dialog-actions button')].find((b) => b.textContent === '同意并继续')
          return JSON.stringify({ found: confirm != null, disabled: confirm?.disabled ?? null })
        })()`
      )
    )
    record('L4 未勾选时「同意并继续」禁用', beforeTick.found && beforeTick.disabled === true, JSON.stringify(beforeTick))

    await cdp.eval(
      `(() => {
        const box = document.querySelector('.dialog-check input')
        if (box != null) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })) }
        return 'ticked'
      })()`
    )
    await new Promise((resolve) => setTimeout(resolve, 200))

    const clicked = JSON.parse(
      await cdp.eval(
        `(() => {
          const confirm = [...document.querySelectorAll('.dialog-actions button')].find((b) => b.textContent === '同意并继续')
          if (confirm != null && !confirm.disabled) confirm.click()
          return JSON.stringify({ found: confirm != null, disabled: confirm?.disabled ?? null })
        })()`
      )
    )
    record('L4 勾选后闸门可同意', clicked.found && clicked.disabled === false, JSON.stringify(clicked))

    // Consent is written by main and re-read before the shell renders, so poll.
    let gateLifted = false
    for (let attempt = 0; attempt < 80; attempt++) {
      const state = await cdp.eval(
        `JSON.stringify({
          shell: document.querySelector('.app-shell') != null,
          clauses: document.querySelectorAll('[data-testid="consent-clauses"] p').length
        })`
      )
      const parsed = JSON.parse(state)
      if (parsed.shell === true && parsed.clauses === 0) {
        gateLifted = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    record('L4 同意后闸门消失、主界面接管', gateLifted, gateLifted ? '' : 'shell 未出现或闸门未收起')

    // L4: first render — four tabs and an honest logged_out badge.
    const dom = await cdp.eval(
      `JSON.stringify({
        tabs: document.querySelectorAll('.tabs button').length,
        badge: document.querySelector('[data-testid="session-badge"]')?.className ?? ''
      })`
    )
    const domState = JSON.parse(dom)
    record('L4 four tabs rendered', domState.tabs === 4, `tabs ${domState.tabs}`)
    record('L4 badge starts logged_out', domState.badge.includes('logged_out'), `badge class "${domState.badge}"`)

    // L4: library assembly — migrations really applied to app.db.
    const dbFile = join(tmpDocs, 'SEU Summary', 'Library', 'app.db')
    const dbExists = existsSync(dbFile)
    record('L4 app.db created in isolated library', dbExists, dbFile)
    if (dbExists) {
      const Database = require('better-sqlite3')
      const db = new Database(dbFile, { readonly: true })
      try {
        const migrations = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n
        record('L4 all ten migrations applied', migrations === 10, `schema_migrations rows ${migrations}`)
        const courseRows = db.prepare('SELECT COUNT(*) AS n FROM courses').get().n
        record('L4 empty library has zero courses', courseRows === 0, `courses ${courseRows}`)
      } finally {
        db.close()
      }
    }

    // L4: the rendererError probe must have reached the redacted file log.
    await waitFor('renderer log line in file', async () => {
      return { ok: readAllLogs(join(tmpUserData, 'logs')).includes(PROBE_LOG_LINE) }
    }, 10000)
    record('L4 log:rendererError reaches file log', true)
  } catch (error) {
    record('smoke run completed', false, String(error?.stack ?? error))
  } finally {
    if (electron?.pid != null) {
      try {
        execFileSync('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        // already gone
      }
    }
  }

  const failed = results.filter((r) => !r.pass)
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail !== '' ? `  — ${r.detail}` : ''}`)
  }
  console.log(`\nSMOKE ${failed.length === 0 ? 'PASSED' : 'FAILED'}: ${results.length - failed.length}/${results.length} checks green`)

  const keep = failed.length > 0
  if (!keep) {
    // taskkill is forceful and Windows may hold file handles for a while
    // after the process tree dies; poll-wipe instead of failing the smoke
    // run over a cleanup race.
    for (const dir of [tmpDocs, tmpUserData]) {
      let wiped = false
      for (let attempt = 0; attempt < 16 && !wiped; attempt++) {
        try {
          rmSync(dir, { recursive: true, force: true })
          wiped = true
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
      if (!wiped) console.log(`warning: cleanup skipped (handles still held): ${dir}`)
    }
  } else {
    console.log(`failure artifacts kept: docs=${tmpDocs} userData=${tmpUserData}`)
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

await main()
