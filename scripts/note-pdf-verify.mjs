/**
 * PDF 讲义「公式是矢量文本」验收（批4, plan 2026-09-17 note-quality upgrade）。
 *
 * 背景：SKILL §6 的矢量铁律要求讲义里文本 ops > 0、字体子集嵌入、图片数 = 附件数。
 * 公式走 KaTeX（HTML+MathML）后，**若它被渲染成图片而不是文字**，这条就破了——
 * 本脚本就是这条的机械验证。
 *
 * 做法：
 *   1. 拷贝真实库到临时目录（**绝不碰原库**），往副本里注入一份带 LaTeX 公式、
 *      表格、概念例子与概念关联的样例笔记（真实笔记里没有 $...$，见 note-ref-audit）；
 *   2. 用真实构建启动应用（SEU_PDF_PATH 绕过保存对话框）；
 *   3. CDP 走：首启闸门 → 选中该课时 → 笔记页 → 点「导出 PDF 讲义」；
 *   4. 扫 PDF 字节：KaTeX 字体子集是否嵌入（= 公式是文字）、是否混入公式图片。
 *
 *   node scripts/note-pdf-verify.mjs [--keep]
 */
import { spawn } from 'child_process'
import { createServer } from 'http'
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const APP_TITLE = 'Flash Summary'
const REAL_LIBRARY = join(homedir(), 'Documents', 'SEU Summary', 'Library')
const LESSON_ID = '1690625-L0'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(label, predicate, timeoutMs, intervalMs = 300) {
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
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    })
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

/** 注入样例笔记：把 LaTeX/表格/例子/关联都覆盖到，才验得全。 */
function injectSampleNote(dbPath) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath)
  const note = {
    overview:
      '## 本讲主线\n本讲以线性分类为例走完训练与调参的完整链路，覆盖数据加载、模型构建、损失计算与超参数搜索。\n## 前置知识\n张量操作与训练循环。\n## 学完能做什么\n能独立定位精度不达标的原因。',
    knowledgeTree: {
      title: '梯度下降实践',
      children: [
        { title: '损失与梯度', children: [{ title: '交叉熵', children: [{ title: '负对数似然', children: [] }] }] },
        { title: '超参数', children: [{ title: '学习率', children: [{ title: '余弦退火', children: [] }] }] }
      ]
    },
    timeline: [
      {
        at: 0,
        title: '学习率对照实验',
        detail: '学习率从 0.1 调到 1.0 之后损失在第三个 epoch 直接发散，调回 0.01 收敛变慢但稳定，讲者结论是先用 0.1 再配余弦退火。',
        refs: [],
        evidence: []
      }
    ],
    concepts: [
      {
        term: '学习率',
        definition: '优化算法中的步长参数，控制每次参数更新的幅度；过大会导致损失震荡难以收敛，过小则收敛速度极慢，通常需要配合调度器动态调整。',
        example: '演示里把学习率从 0.1 调到 1.0，损失曲线在第三个 epoch 直接发散。'
      },
      {
        term: '交叉熵',
        definition: '分类任务常用的损失函数，衡量预测分布与真实分布之间的差异，等价于真实分布下的负对数似然，越小表示预测越接近目标。'
      }
    ],
    formulasAndSteps: [
      { kind: 'formula', content: '$$L = -\\frac{1}{N}\\sum_{i=1}^{N} y_i \\log p_i$$', explanation: '交叉熵损失的整体形式。', refs: [] },
      { kind: 'formula', content: '行内小公式 $\\eta_t = \\eta_0 \\cos(t)$ 的写法也要能渲染', explanation: '调度器形式。', refs: [] },
      { kind: 'code', content: 'for epoch in range(10):\n    loss = criterion(model(x), y)\n    loss.backward()\n    opt.step()', explanation: '训练循环骨架。', refs: [] }
    ],
    methodology: '## 解题思路\n先搭最小可运行管线再逐步调参。\n\n| 参数 | 取值 | 说明 |\n|---|---|---|\n| 学习率 | 0.1 | 初值 |\n| 批量 | 32 | 稳定 |',
    examCues: ['手推交叉熵损失的梯度公式'],
    questionsAndGaps: [],
    quiz: [
      { question: '学习率过大有什么后果?', answer: '损失震荡甚至发散。', source: 'concept', term: '学习率' },
      { question: '交叉熵衡量什么?', answer: '预测分布与真实分布的差异。', source: 'concept', term: '交叉熵' },
      { question: '讲者推荐的调度策略?', answer: '先用 0.1 再配余弦退火。', source: 'concept', term: '学习率' },
      { question: '发散出现在第几个 epoch?', answer: '第三个。', source: 'concept', term: '学习率' },
      { question: '损失函数的标准写法?', answer: '负对数似然求和后取平均。', source: 'concept', term: '交叉熵' }
    ],
    conceptLinks: [
      { from: '学习率', to: '交叉熵', label: '因果' },
      { from: '学习率', to: '余弦退火', label: '包含' }
    ],
    transcriptRefs: [],
    evidence: []
  }
  const versionRow = db.prepare('SELECT MAX(version) AS v FROM notes WHERE lesson_id = ?').get(LESSON_ID)
  const version = (versionRow?.v ?? 0) + 1
  // 真实库还没跑过 migration 011（没有 prompt_version 列）——用原始列插入即可，
  // 应用启动时会自己把迁移跑在副本上。顺带这就验证了「迁移能干净作用于真实库副本」。
  db.prepare(
    'INSERT INTO notes (id, lesson_id, version, note_json, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(`${LESSON_ID}-v${version}`, LESSON_ID, version, JSON.stringify(note), 'openai-compatible', 'pdf-verify', new Date().toISOString())
  const lesson = db.prepare('SELECT title FROM lessons WHERE id = ?').get(LESSON_ID)
  db.close()
  return { version, lessonTitle: lesson?.title ?? '' }
}

async function main() {
  const outDir = mkdtempSync(join(tmpdir(), 'seu-pdf-verify-'))
  const tmpDocs = join(outDir, 'docs')
  const tmpLib = join(tmpDocs, 'SEU Summary', 'Library')
  mkdirSync(tmpLib, { recursive: true })
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const src = join(REAL_LIBRARY, f)
    if (existsSync(src)) copyFileSync(src, join(tmpLib, f))
  }
  const copiedDb = join(tmpLib, 'app.db')
  const injected = injectSampleNote(copiedDb)
  console.log(`注入样例笔记 ${LESSON_ID} v${injected.version}「${injected.lessonTitle}」（副本：${copiedDb}）`)

  // 附件：副本里没有 keyframes 的图片文件（真实库的 attachments 在 Library 下，
  // 这里没拷）——导出流程对缺图是容忍的（waitForImages 只等已渲染的），足以验公式。
  const pdfPath = join(outDir, 'handout.pdf')
  const port = await findFreePort(9600 + Math.floor(Math.random() * 200))
  const electron = spawn(require('electron'), ['.', `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    env: { ...process.env, SEU_SUMMARY_DOCS_OVERRIDE: tmpDocs, SEU_PDF_PATH: pdfPath, ELECTRON_RENDERER_URL: '' },
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
      30000
    )
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket connect failed')), { once: true })
    })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable')

    // 首启闸门（副本库没有同意记录时会拦）
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
      20000
    )
    const gated = JSON.parse(
      await cdp.eval(
        `JSON.stringify({ gate: document.querySelector('[data-testid="consent-clauses"]') != null })`
      )
    ).gate
    if (gated === true) {
      await cdp.eval(`(() => {
        const box = document.querySelector('.dialog-check input')
        if (box == null) return false
        box.checked = true
        box.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`)
      await sleep(250)
      await cdp.eval(`(() => {
        const btn = [...document.querySelectorAll('.dialog-actions button')].find((b) => b.textContent === '同意并继续')
        if (btn == null || btn.disabled) return false
        btn.click()
        return true
      })()`)
      await waitFor('consent lifted', async () => {
        try {
          return { ok: (await cdp.eval('document.querySelector(".app-shell") != null')) === true }
        } catch {
          return { ok: false }
        }
      }, 15000)
    }

    // 直接用渲染层状态选中目标课时（比在侧栏里翻找稳）
    await waitFor('course tree', async () => {
      try {
        const n = await cdp.eval('document.querySelectorAll(".sidebar .course-item").length')
        return { ok: typeof n === 'number' && n > 0, value: n }
      } catch {
        return { ok: false }
      }
    }, 20000)

    // 按**课时标题**精确选中注入的那一节（侧栏课时行没有 id 属性，但有 title）。
    // 不能像 ui-shots 那样「随便找一节有笔记的」——那会验到别的笔记上。
    const targetTitle = JSON.stringify(injected.lessonTitle)
    let selected = false
    for (let attempt = 0; attempt < 40 && !selected; attempt++) {
      const stepped = await cdp.eval(`(() => {
        if (window.__pdfHeadIdx == null) window.__pdfHeadIdx = 0
        const rows = [...document.querySelectorAll('.sidebar .lesson-row')]
        if (rows.some((r) => r.getAttribute('title') === ${targetTitle})) return 'found'
        const heads = [...document.querySelectorAll('.sidebar .course-head')]
        for (const h of heads) {
          if (h.getAttribute('aria-expanded') === 'true' && heads.indexOf(h) !== window.__pdfHeadIdx) h.click()
        }
        const head = heads[window.__pdfHeadIdx]
        if (head == null) return 'exhausted'
        if (head.getAttribute('aria-expanded') !== 'true') head.click()
        return 'ok'
      })()`)
      if (stepped === 'exhausted') break
      await sleep(300)
      selected =
        (await cdp.eval(`(() => {
          const row = [...document.querySelectorAll('.sidebar .lesson-row')].find((r) => r.getAttribute('title') === ${targetTitle})
          if (row == null) return false
          row.click()
          return true
        })()`)) === true
      if (!selected && stepped === 'ok') {
        const exhausted = await cdp.eval('window.__pdfHeadIdx = (window.__pdfHeadIdx ?? 0) + 1; window.__pdfHeadIdx > 40')
        if (exhausted === true) break
      }
    }
    if (!selected) throw new Error(`没有在侧栏找到课时「${injected.lessonTitle}」`)
    await sleep(1200)

    // 注意有两处「页签」：主标签是 `.tabs`（任务/笔记/追问/设置），笔记五视图是
    // `.note-tabs`。这里要切的是**视图**，用后者（前者找不到「方法论」会静默不切）。
    const goTab = (label) =>
      cdp.eval(
        `(() => { const b = [...document.querySelectorAll('.note-tabs button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b == null) return false; b.click(); return true })()`
      )
    const goMainTab = (label) =>
      cdp.eval(
        `(() => { const b = [...document.querySelectorAll('.tabs button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (b == null) return false; b.click(); return true })()`
      )
    if ((await goMainTab('笔记')) !== true) throw new Error('笔记页签未找到')
    await waitFor('note viewer', async () => {
      try {
        return { ok: (await cdp.eval('document.querySelector(".note-actions") != null')) === true }
      } catch {
        return { ok: false }
      }
    }, 20000)

    // 把公式所在段落滚进视野，顺带确认 KaTeX 真的渲染了（DOM 探针）
    // 详细笔记页不含方法论，表格在方法论视图里——切过去数一遍（表格是批4 修的缺陷）。
    if ((await goTab('方法论')) !== true) throw new Error('方法论视图页签未找到')
    await sleep(500)
    const methodologyProbe = await cdp.eval(`JSON.stringify({
      tables: document.querySelectorAll('.md-table').length,
      tableCells: document.querySelectorAll('.md-table td').length,
      mdLite: document.querySelectorAll('.md-lite').length,
      paneText: (document.querySelector('.note-body')?.textContent ?? document.body.textContent).slice(0, 300)
    })`)
    console.log('方法论视图探针（表格）：', methodologyProbe)
    await goTab('详细笔记')
    await sleep(400)

    const probe = await cdp.eval(`JSON.stringify({
      katex: document.querySelectorAll('.katex').length,
      katexDisplay: document.querySelectorAll('.katex-display').length,
      mathError: document.querySelectorAll('.md-math-error').length,
      tables: document.querySelectorAll('.md-table').length,
      conceptExamples: document.querySelectorAll('.concept-example').length,
      codeNumbered: document.querySelectorAll('.code-block.code-numbered').length,
      codeLines: document.querySelectorAll('.code-block .code-line').length
    })`)
    console.log('DOM 探针：', probe)

    const clicked = await cdp.eval(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '导出 PDF 讲义')
      if (btn == null) return false
      btn.click()
      return true
    })()`)
    if (clicked !== true) throw new Error('「导出 PDF 讲义」按钮未找到')

    // 版权提醒会拦一道（七个出口统一过闸）
    await sleep(600)
    await cdp.eval(`(() => {
      const box = document.querySelector('.dialog-check input')
      if (box != null && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })) }
      return true
    })()`)
    await sleep(250)
    const confirmed = await cdp.eval(`(() => {
      const btn = [...document.querySelectorAll('.dialog-actions button')].find((b) => /导出|继续|确定/.test(b.textContent) && !b.disabled)
      if (btn == null) return false
      btn.click()
      return true
    })()`)
    console.log('导出提醒确认：', confirmed)

    await waitFor(
      'pdf written',
      async () => ({ ok: existsSync(pdfPath) && statSync(pdfPath).size > 1024, value: existsSync(pdfPath) ? statSync(pdfPath).size : 0 }),
      60000,
      500
    )

    // ---- PDF 字节核验 ----
    const bytes = readFileSync(pdfPath)
    const text = bytes.toString('latin1')
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
    const images = (text.match(/\/Subtype\s*\/Image/g) ?? []).length
    const katexFonts = [...new Set((text.match(/\/BaseFont\s*\/[A-Za-z0-9+#_-]*KaTeX[A-Za-z0-9+#_-]*/g) ?? []).map((s) => s.split('/').pop()))]
    const anyKaTeX = /KaTeX/.test(text)
    const fontSubsets = (text.match(/\/BaseFont\s*\/[A-Z]{6}\+/g) ?? []).length

    console.log('\n—— PDF 核验 ——')
    console.log(`文件: ${pdfPath}`)
    console.log(`大小: ${bytes.length.toLocaleString()} B   页数(粗解析): ${pages}`)
    console.log(`内嵌 KaTeX 字体: ${anyKaTeX ? '是' : '否'} ${katexFonts.length > 0 ? JSON.stringify(katexFonts.slice(0, 4)) : ''}`)
    console.log(`字体子集前缀数: ${fontSubsets}`)
    console.log(`图片对象: ${images}`)

    // 迁移在真实库副本上的实测：副本来自真实库，原本**没有** prompt_version 列
    // （应用没跑过新构建），启动后应已补上并记录到 schema_migrations。
    let migrationOk = false
    let migrationDetail = ''
    try {
      const Database = require('better-sqlite3')
      const check = new Database(copiedDb, { readonly: true })
      const applied = check.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n
      const cols = (check.prepare('PRAGMA table_info(notes)').all() ?? []).map((c) => c.name)
      check.close()
      migrationOk = applied >= 11 && cols.includes('prompt_version') && cols.includes('schema_version')
      migrationDetail = `schema_migrations=${applied}；notes 含 prompt_version=${cols.includes('prompt_version')} schema_version=${cols.includes('schema_version')}`
    } catch (e) {
      migrationDetail = String(e.message)
    }
    console.log(`
—— 迁移核验（真实库副本）——
${migrationDetail}
判定：${migrationOk ? '✅ 通过' : '❌ 未生效'}`)

    const ok = anyKaTeX && katexFonts.length > 0 && migrationOk
    console.log(`\n判定：公式为矢量文本 ${ok ? '✅ 通过（KaTeX 字体子集已嵌入，说明公式是文字不是图片）' : '❌ 未检出 KaTeX 字体'}`)
    if (!ok) process.exitCode = 1
  } finally {
    electron.kill()
    const keep = process.argv.includes('--keep')
    if (!keep) {
      await sleep(500)
      rmSync(outDir, { recursive: true, force: true })
    } else {
      console.log(`保留产物目录：${outDir}`)
    }
  }
}

main().catch((err) => {
  console.error(String(err?.stack ?? err))
  process.exit(1)
})
