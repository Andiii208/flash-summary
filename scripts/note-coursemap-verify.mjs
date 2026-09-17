/**
 * 课程级导图验收（批5 验收项「真实库课程级导图截图过目」）。
 *
 * 为什么需要先造数据：真实库里每门课只有 1 节有笔记，`mergeCourseTree` 的跨课时合并
 * 是空操作，课程导图看不出任何「合并」内容。
 *
 * 做法：在**副本**上真实导入同一门 B站课的**另一个分P**（走应用正常的导入流程：
 * 字幕快路径不下载音频、不跑 ASR；关键帧取 360P 视频流），等流程跑完拿到第二份真实
 * 笔记，再打开课程导图截图。
 *
 * 全部在临时副本里发生（库 + 下载 + 生成），真实库与真实 Documents 目录不受影响。
 *
 *   node scripts/note-coursemap-verify.mjs [--page=4] [--no-import]
 */
import { spawn } from 'child_process'
import { createServer } from 'http'
import { mkdirSync, copyFileSync, cpSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const APP_TITLE = 'Flash Summary'
const REAL_LIBRARY = join(homedir(), 'Documents', 'SEU Summary', 'Library')
const REAL_USER_DATA = join(homedir(), 'AppData', 'Roaming', 'seu-summary')
const BVID = 'BV1vQMBz6EvP'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(label, predicate, timeoutMs, intervalMs = 1000) {
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
  async eval(expression, timeoutMs = 60000) {
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

async function main() {
  const pageArg = process.argv.find((a) => a.startsWith('--page='))
  const targetPage = pageArg != null ? Number(pageArg.slice('--page='.length)) : 4
  const skipImport = process.argv.includes('--no-import')

  const workDir = join(ROOT, '.coursemap-verify')
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true })
  const tmpDocs = join(workDir, 'docs')
  const tmpLib = join(tmpDocs, 'SEU Summary', 'Library')
  const tmpUserData = join(workDir, 'userdata')
  mkdirSync(tmpLib, { recursive: true })
  mkdirSync(tmpUserData, { recursive: true })
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const src = join(REAL_LIBRARY, f)
    if (existsSync(src)) copyFileSync(src, join(tmpLib, f))
  }
  if (existsSync(join(REAL_LIBRARY, 'attachments'))) {
    cpSync(join(REAL_LIBRARY, 'attachments'), join(tmpLib, 'attachments'), { recursive: true })
  }
  copyFileSync(join(REAL_USER_DATA, 'Local State'), join(tmpUserData, 'Local State'))
  console.log(`工作副本: ${workDir}\n`)

  const port = await findFreePort(9900 + Math.floor(Math.random() * 90))
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

    const session = await cdp.eval(
      `(async () => JSON.stringify(await window.seuSummary.bilibili.session()))()`,
      20000
    )
    console.log(`B站登录态: ${session}\n`)

    let courseId = ''
    if (skipImport) {
      // 跳过导入：直接从已有笔记里找 B站 课程的 courseId（用于只复查截图）
      const helper = await cdp.eval(
        `(async () => JSON.stringify((await window.seuSummary.notes.list()).value ?? []))()`,
        20000
      )
      const rows = JSON.parse(helper)
      const hit = (Array.isArray(rows) ? rows : []).find((r) => String(r.lessonId ?? '').startsWith('bili-'))
      courseId = hit?.courseId ?? ''
    } else {
      const resolved = await cdp.eval(
        `(async () => JSON.stringify(await window.seuSummary.bilibili.resolve(${JSON.stringify(BVID)})))()`,
        60000
      )
      const resolveResult = JSON.parse(resolved)
      const parts = resolveResult?.value?.parts ?? resolveResult?.value?.pages ?? []
      console.log(`解析：${resolveResult?.ok === true ? '成功' : '失败'}；分P ${Array.isArray(parts) ? parts.length : '?'} 个`)
      if (Array.isArray(parts) && parts.length > 0) {
        const picked = parts.find((p) => p.page === targetPage) ?? parts[0]
        console.log(`  将导入 P${picked.page}：${String(picked.part ?? picked.title ?? '').slice(0, 60)}（${Math.round((picked.duration ?? 0) / 60)} 分钟）\n`)
      }

      console.log(`开始导入 P${targetPage}（字幕快路径；关键帧需下载 360P 视频流，耗时较长）…`)
      const imported = await cdp.eval(
        `(async () => JSON.stringify(await window.seuSummary.bilibili.import({ bvid: ${JSON.stringify(BVID)}, pages: [${targetPage}] })))()`,
        180000
      )
      const importResult = JSON.parse(imported)
      console.log(`导入返回: ${JSON.stringify(importResult).slice(0, 300)}\n`)
      courseId = importResult?.value?.courseId ?? ''
      const newLessonIds = importResult?.value?.lessonIds ?? []

      // 导入只建课时行——**跑管线要另发任务**（应用里是渲染层的自动串联：
      // tasks:create → tasks:runAsync，见 App 的 createAndRun）。
      if (newLessonIds.length > 0) {
        const lessonId = newLessonIds[0]
        const created = await cdp.eval(
          `(async () => JSON.stringify(await window.seuSummary.tasks.create(${JSON.stringify(lessonId)})))()`,
          30000
        )
        const taskId = JSON.parse(created)?.value?.id
        console.log(`已建任务 ${taskId}，开始运行（字幕快路径 + 抽帧 + 多模态总结）…`)
        if (taskId != null) {
          await cdp.eval(
            `(async () => JSON.stringify(await window.seuSummary.tasks.runAsync(${JSON.stringify(taskId)})))()`,
            60000
          )
        }
        console.log(`等待 ${lessonId} 的笔记生成…`)
        const noteJson = await waitFor(
          'second note',
          async () => {
            try {
              const raw = await cdp.eval(
                `(async () => JSON.stringify(await window.seuSummary.notes.latest(${JSON.stringify(lessonId)})))()`,
                30000
              )
              const parsed = JSON.parse(raw)
              const note = parsed?.value
              return { ok: note != null && typeof note === 'object' && note.knowledgeTree != null, value: parsed?.ok === true ? 'note present' : raw.slice(0, 120) }
            } catch {
              return { ok: false }
            }
          },
          30 * 60 * 1000,
          5000
        )
        console.log(`第二份笔记已就绪：${noteJson}\n`)
      }
    }

    // 课程导图：桥面数据 + 界面截图
    if (courseId === '') {
      const listRaw = await cdp.eval(`(async () => JSON.stringify((await window.seuSummary.notes.list()).value ?? []))()`, 30000)
      const rows = JSON.parse(listRaw)
      const hit = (Array.isArray(rows) ? rows : []).find((r) => String(r.courseId ?? '').startsWith('bili-'))
      courseId = hit?.courseId ?? ''
    }
    console.log(`课程 id: ${courseId || '(未找到)'}`)
    if (courseId !== '') {
      const merged = await cdp.eval(
        `(async () => JSON.stringify(await window.seuSummary.notes.courseTree(${JSON.stringify(courseId)})))()`,
        60000
      )
      const parsedMerged = JSON.parse(merged)
      const tree = parsedMerged?.value?.tree
      const countNodes = (n) => (n == null ? 0 : 1 + (n.children ?? []).reduce((a, c) => a + countNodes(c), 0))
      console.log(`课程导图聚合：ok=${parsedMerged?.ok} 合并课时数=${parsedMerged?.value?.lessons} 跳过=${parsedMerged?.value?.skipped} 节点数=${countNodes(tree)}`)
      console.log(`根标题：${tree?.title ?? '(无)'}`)
      console.log(`第一层分支：${(tree?.children ?? []).map((c) => String(c.title).slice(0, 24)).join(' | ')}\n`)
    }

    // 界面：切到笔记页 → 点该课程的「查看课程导图」→ 截图
    await cdp.eval(
      `(() => { const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.trim() === '笔记'); if (b != null) b.click(); return true })()`
    )
    await sleep(1200)
    const opened = await cdp.eval(`(() => {
      const btns = [...document.querySelectorAll('[aria-label^="查看课程导图"]')]
      if (btns.length === 0) return 'no-button'
      const bili = btns.find((b) => (b.getAttribute('aria-label') ?? '').includes('CS224N')) ?? btns[0]
      bili.click()
      return bili.getAttribute('aria-label')
    })()`)
    console.log(`课程导图入口: ${opened}`)
    const dialogShown = await waitFor(
      'course map dialog',
      async () => {
        try {
          const present = await cdp.eval(
            `document.querySelector('[data-testid="course-map-dialog"]') != null || document.querySelector('.dialog-card .mindmap, .dialog-card svg') != null`
          )
          return { ok: present === true, value: present }
        } catch {
          return { ok: false }
        }
      },
      30000
    )
    console.log(`弹层出现：${dialogShown}`)
    await sleep(1500)
    await cdp.shot(join(workDir, 'coursemap.png'))

    // 几何量测：初始视图是否覆盖整幅图（尤其根节点在不在视野内）
    const geometry = await cdp.eval(`(() => {
      const scroller = document.querySelector('.course-map-card .mindmap-scroll, .course-map-card [class*=scroll], .course-map-card div')
      const svg = document.querySelector('.course-map-card svg')
      if (svg == null) return JSON.stringify({ error: 'no svg' })
      const box = svg.getBoundingClientRect()
      const viewBox = svg.getAttribute('viewBox')
      const scrollHost = svg.parentElement
      return JSON.stringify({
        svgAttr: { w: Number(svg.getAttribute('width')), h: Number(svg.getAttribute('height')) },
        viewBox,
        rendered: { w: Math.round(box.width), h: Math.round(box.height) },
        host: scrollHost != null ? { cls: scrollHost.className, cw: scrollHost.clientWidth, ch: scrollHost.clientHeight, sw: scrollHost.scrollWidth, sh: scrollHost.scrollHeight } : null,
        nodes: document.querySelectorAll('.course-map-card svg g').length
      })
    })()`)
    console.log(`
导图几何：${geometry}`)
  } finally {
    electron.kill()
    await sleep(600)
    console.log(`\n副本保留在 ${workDir}（供复查）`)
  }
}

main().catch((err) => {
  console.error(String(err?.stack ?? err))
  process.exit(1)
})
