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
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const APP_TITLE = 'SEU Summary'
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

/** Expected bridge surface — keep in sync with src/shared/bridge.ts. */
const EXPECTED_BRIDGE = {
  school: ['login', 'logout', 'session', 'listCourses', 'addManualCourse', 'courseTree'],
  providers: ['list', 'save', 'remove', 'bind'],
  tasks: ['create', 'list', 'run', 'runAsync', 'cancel', 'onProgress'],
  notes: ['latest', 'exportMarkdown'],
  qa: ['ask', 'history'],
  settings: ['get', 'setCacheDir', 'setTheme', 'chooseLibrary', 'openPath'],
  log: ['rendererError']
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
  ['notes:latest (missing)', "s.notes.latest('smoke-none')", (r) => r.ok === true && r.value === null],
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
  const port = 9300 + Math.floor(Math.random() * 200)
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
          return { ok: true, value: list.find((t) => t.type === 'page' && t.title.includes(APP_TITLE)) }
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
        record('L4 all five migrations applied', migrations === 5, `schema_migrations rows ${migrations}`)
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
