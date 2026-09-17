/**
 * 重生成端到端（批1/批3 验收项, plan 2026-09-17 note-quality upgrade）。
 *
 * 在**真实库副本**上跑真实「重新生成」：复用已存转写与关键帧（零下载），调真实
 * MiMo 多模态模型，走完整的新链路（时间锚素材 → 生成 → 核验 → 体检 → 一次有界返修）。
 *
 * 隔离（三处都不碰真实数据）：
 *   - 库：拷贝 app.db(+wal/shm) 与 attachments/ 到临时目录 → SEU_SUMMARY_DOCS_OVERRIDE
 *   - 凭据：拷贝真实 userData 的 Local State（DPAPI/os_crypt 的 AES key 在里面）→ SEU_SMOKE_USER_DATA
 *     （provider 密钥在 providers 表里、用该 key 加密，所以两者必须配套）
 *
 * 触发方式：直接调渲染层的真实 IPC `window.seuSummary.notes.regenerate(lessonId)`
 * （与点「重新生成」按钮同一条路径），避免 UI 点击的时序脆弱。
 *
 *   node scripts/note-regen-e2e.mjs [--keep] [--lessons=1690406-L0,1690625-L0,bili-...]
 *
 * 报告逐课写盘（--keep 时保留），便于跨多次调用累积进度。
 */
import { spawn } from 'child_process'
import { createServer } from 'http'
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, existsSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const APP_TITLE = 'Flash Summary'
const REAL_LIBRARY = join(homedir(), 'Documents', 'SEU Summary', 'Library')
const REAL_USER_DATA = join(homedir(), 'AppData', 'Roaming', 'seu-summary')
const DEFAULT_LESSONS = ['1690406-L0', '1690625-L0', 'bili-BV1vQMBz6EvP-P3']
/**
 * 单课上限必须**大于两次串联的聊天超时**：生成一次 + 返修一次，
 * 而客户端自己的上限是 CHAT_TIMEOUT_MS = 600_000（10 分钟/次）。这里取 25 分钟，
 * 保证我们观察到的是**应用自己的**超时/结果，而不是被脚本提前掐断。
 */
const PER_LESSON_TIMEOUT_MS = 25 * 60 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(label, predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await predicate()
    if (last.ok) return last.value
    await sleep(intervalMs)
  }
  throw new Error(`${label} not reached within ${timeoutMs}ms (last: ${JSON.stringify(last?.value ?? null)})`)
}

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
  async eval(expression, timeoutMs = 30000) {
    const result = await Promise.race([
      this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }),
      sleep(timeoutMs).then(() => {
        throw new Error(`evaluate timed out after ${timeoutMs}ms`)
      })
    ])
    if (result.exceptionDetails != null) {
      throw new Error(`evaluate threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
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

async function main() {
  const keep = process.argv.includes('--keep')
  const lessonsArg = process.argv.find((a) => a.startsWith('--lessons='))
  const lessons = lessonsArg != null ? lessonsArg.slice('--lessons='.length).split(',').filter(Boolean) : DEFAULT_LESSONS

  const workDir = mkdtempSync(join(tmpdir(), 'seu-regen-'))
  const tmpDocs = join(workDir, 'docs')
  const tmpLib = join(tmpDocs, 'SEU Summary', 'Library')
  const tmpUserData = join(workDir, 'userdata')
  mkdirSync(tmpLib, { recursive: true })
  mkdirSync(tmpUserData, { recursive: true })

  // 库副本（db + WAL + 附件）——附件必须一起拷，否则取不到图，融合与视觉证据就变空
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const src = join(REAL_LIBRARY, f)
    if (existsSync(src)) copyFileSync(src, join(tmpLib, f))
  }
  if (existsSync(join(REAL_LIBRARY, 'attachments'))) {
    cpSync(join(REAL_LIBRARY, 'attachments'), join(tmpLib, 'attachments'), { recursive: true })
  }
  // 凭据副本：Local State 里是 os_crypt 的 AES key（DPAPI 包裹），缺它解不开 provider 密钥
  const localState = join(REAL_USER_DATA, 'Local State')
  if (!existsSync(localState)) throw new Error(`缺少 ${localState}——没有它解不开 provider 密钥`)
  copyFileSync(localState, join(tmpUserData, 'Local State'))

  console.log(`库副本: ${tmpLib}`)
  console.log(`凭据副本(Local State): ${tmpUserData}`)
  console.log(`待重生成: ${lessons.join(', ')}\n`)

  const reportPath = join(ROOT, keep ? '.regen-e2e-report.json' : join(workDir, 'report.json'))
  const report = { startedAt: new Date().toISOString(), workDir, lessons: {} }

  const port = await findFreePort(9800 + Math.floor(Math.random() * 150))
  const electron = spawn(require('electron'), ['.', `--remote-debugging-port=${port}`], {
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
  electron.stderr.on('data', (d) => process.stderr.write(String(d).slice(0, 300)))

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
      40000
    )
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket connect failed')), { once: true })
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')

    await waitFor(
      'shell or consent gate',
      async () => {
        try {
          const raw = await cdp.eval(
            `JSON.stringify({ gate: document.querySelector('[data-testid="consent-clauses"]') != null, shell: document.querySelector('.app-shell') != null })`
          )
          const p = JSON.parse(raw)
          return { ok: p.gate === true || p.shell === true, value: raw }
        } catch {
          return { ok: false }
        }
      },
      30000
    )
    const gated = JSON.parse(
      await cdp.eval(`JSON.stringify({ gate: document.querySelector('[data-testid="consent-clauses"]') != null })`)
    ).gate
    if (gated === true) {
      await cdp.eval(`(() => {
        const box = document.querySelector('.dialog-check input')
        if (box == null) return false
        box.checked = true
        box.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      await sleep(300)
      await cdp.eval(`(() => {
        const btn = [...document.querySelectorAll('.dialog-actions button')].find((b) => b.textContent === '同意并继续')
        if (btn == null || btn.disabled) return false
        btn.click()
        return true
      })()`)
      await waitFor(
        'consent lifted',
        async () => {
          try {
            return { ok: (await cdp.eval('document.querySelector(".app-shell") != null')) === true }
          } catch {
            return { ok: false }
          }
        },
        20000
      )
    }

    // 桥面就绪 + 密钥可解（providers:list 成功即说明 DPAPI 解开了）
    // 桥面 + provider 配置就绪。providers:list 返回的是对象（含 providers/bindings），
    // 不是数组——只要 ok 即可，说明 DPAPI 也把密钥解开了。
    const bridgeReady = await waitFor(
      'bridge + providers',
      async () => {
        try {
          const raw = await cdp.eval(
            `(async () => {
              if (window.seuSummary == null) return JSON.stringify({ ready: false })
              const res = await window.seuSummary.providers.list()
              return JSON.stringify({ ready: true, ok: res.ok, keys: res.value != null ? Object.keys(res.value) : [] })
            })()`,
            25000
          )
          const parsed = JSON.parse(raw)
          return { ok: parsed.ready === true && parsed.ok === true, value: raw }
        } catch {
          return { ok: false }
        }
      },
      40000,
      1000
    )
    console.log(`provider 就绪：${bridgeReady}\n`)

    // 桥面没有独立的「读绑定」方法——把 providers:list 的返回打出来（截断），
    // 便于确认即将调用的是哪个 provider。注意 Runtime.evaluate 里不能写顶层 await，
    // 必须包成 async IIFE。
    const bindings = await cdp.eval(
      `(async () => JSON.stringify((await window.seuSummary.providers.list()).value ?? null))()`,
      20000
    )
    console.log(`provider 列表（截断）：${String(bindings).slice(0, 400)}\n`)

    for (const lessonId of lessons) {
      console.log(`—— 重生成 ${lessonId} ——`)
      const started = Date.now()
      const raw = await cdp.eval(
        `(async () => {
          try {
            const res = await window.seuSummary.notes.regenerate(${JSON.stringify(lessonId)})
            return JSON.stringify({ done: true, res })
          } catch (e) {
            return JSON.stringify({ done: true, threw: String(e && e.message ? e.message : e) })
          }
        })()`,
        PER_LESSON_TIMEOUT_MS
      )
      const parsed = JSON.parse(raw)
      const elapsedSec = Math.round((Date.now() - started) / 1000)
      report.lessons[lessonId] = { elapsedSec, ...parsed }
      console.log(`  用时 ${elapsedSec}s`)
      console.log(`  返回: ${JSON.stringify(parsed.res ?? parsed.threw)}`)
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
      console.log('')
    }

    report.finishedAt = new Date().toISOString()
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
    console.log(`报告: ${reportPath}`)
    if (keep) console.log(`副本保留在: ${tmpLib}\n可直接跑：npx vite-node scripts/note-ref-audit.ts "${join(tmpLib, 'app.db')}" --label="重生成后"`)
  } finally {
    electron.kill()
    await sleep(600)
    if (!keep) {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {
        /* 临时目录清理失败不影响结论 */
      }
    }
  }
}

main().catch((err) => {
  console.error(String(err?.stack ?? err))
  process.exit(1)
})
