/**
 * UI screenshot harness (dev tool for the visual overhaul): boots the real
 * built app against a THROWAWAY COPY of the real library db (never the real
 * files), then walks the main views over CDP and saves PNGs.
 *
 *   node scripts/ui-shots.mjs [outDir] [--prefix=name]
 *                            [--light|--dark] [--bili] [--compliance] [--my-study]
 *
 * 专项机位（拍完即退出，不走主流程清单）：--bili（B站导入对话框）、
 * --compliance（声明层四个界面）、--my-study（「我的学习」全屏弹层，批4 P9）。
 *
 * Library isolation: copies app.db(-wal/-shm) plus attachments/ into a temp
 * dir and points SEU_SUMMARY_DOCS_OVERRIDE at it — the running installed app
 * and the real Library are never touched. userData stays the normal `-dev` one.
 * Requires Node >= 22 (native WebSocket/fetch) and a fresh `npm run build`.
 */
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  sleep,
  waitFor,
  waitForShell,
  acceptConsentGate,
  clickByText,
  killApp,
  removeDir,
  spawnApp,
  connect,
  prepareThrowawayDocs
} from './lib/ui-cdp.mjs'

const ROOT = join(import.meta.dirname, '..')

async function main() {
  const outDir = process.argv[2] != null && !process.argv[2].startsWith('--') ? process.argv[2] : join(ROOT, '.ui-shots')
  const prefixArg = process.argv.find((a) => a.startsWith('--prefix='))
  const prefix = prefixArg != null ? prefixArg.slice('--prefix='.length) : ''
  mkdirSync(outDir, { recursive: true })
  const shotName = (name) => join(outDir, `${prefix}${name}.png`)

  // Throwaway library copy (db + attachments — note-page shots need the
  // timeline images); the real Library stays untouched (WAL-safe by copy).
  const tmpDocs = prepareThrowawayDocs({ withAttachments: true })

  const outMain = join(ROOT, 'out', 'main', 'index.cjs')
  if (!existsSync(outMain)) {
    console.error('out/main/index.cjs missing — run `npm run build` first')
    process.exit(1)
  }

  const { electron, port } = await spawnApp(tmpDocs)

  try {
    const cdp = await connect(port)

    // 声明批2: a library without recorded consent stops at the 使用须知 gate, so
    // the shell (and the course tree) does not exist yet. Wait for EITHER, then
    // walk the gate before anything else can run.
    const applyTheme = async (theme) => {
      await cdp.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`)
      await sleep(350)
    }
    const gated = (await waitForShell(cdp)) === 'gate'
    if (process.argv.includes('--compliance') && gated) {
      // The gate itself is one of the surfaces under review — shoot it in both
      // themes BEFORE accepting (accepting re-reads settings, which re-runs the
      // theme effect and drops the DOM override when the stored theme is auto).
      await applyTheme('light')
      await cdp.shot(shotName('c1-consent-light'))
      await applyTheme('dark')
      await cdp.shot(shotName('c1-consent-dark'))
      await applyTheme('light')
    }
    if (gated) await acceptConsentGate(cdp)

    await waitFor('course tree', async () => {
      try {
        const n = await cdp.eval('document.querySelectorAll(".sidebar .course-item").length')
        return { ok: typeof n === "number" && n > 0, value: n }
      } catch {
        return { ok: false }
      }
    }, 20000)

    // --light / --dark: pin the theme via DOM override (auto follows the OS).
    // Deliberately AFTER the gate: accepting consent re-reads settings, and the
    // theme effect would otherwise clear the override.
    if (process.argv.includes('--light')) await applyTheme('light')
    if (process.argv.includes('--dark')) await applyTheme('dark')

    // 1. initial view (tasks tab, nothing selected)
    await sleep(400)

    // --bili: dedicated Bilibili-dialog shots (no library walk needed).
    // Resolves a real public video + starts a real QR login — no account,
    // no writes, read-only public endpoints.
    if (process.argv.includes('--bili')) {
      // 批1 双源并列: the entry is the sidebar button next to 刷新课程; the
      // whole flow lives in the first-class dialog now.
      const openDialog = `(() => {
        const btn = [...document.querySelectorAll('.sidebar-head button')].find((b) => b.textContent.trim() === '导入 B站视频')
        if (btn == null) return false
        btn.click()
        return true
      })()`
      if ((await cdp.eval(openDialog)) !== true) throw new Error('sidebar B站 entry button not found')
      await waitFor('bili dialog', async () => {
        try {
          return { ok: (await cdp.eval('document.querySelector("[data-testid=\'bili-import-dialog\']") != null')) === true, value: true }
        } catch {
          return { ok: false }
        }
      }, 20000)
      await sleep(300)
      await cdp.shot(shotName('b1-dialog-input'))

      const focusInput = `(() => {
        const input = document.querySelector('.bili-dialog-card .qa-input')
        if (input == null) return false
        input.focus()
        return true
      })()`
      if ((await cdp.eval(focusInput)) !== true) throw new Error('bili input not found')
      // Real browser input path — synthetic .value writes do not reach the
      // controlled component through Preact reliably.
      await cdp.send('Input.insertText', { text: 'BV1GJ411x7h7' })
      await sleep(200)
      const clickResolve = `(() => {
        const btn = [...document.querySelectorAll('.bili-dialog-card button')].find((b) => b.textContent.trim() === '解析')
        if (btn == null) return false
        btn.click()
        return true
      })()`
      if ((await cdp.eval(clickResolve)) !== true) throw new Error('resolve click failed')
      await waitFor('bili preview card', async () => {
        try {
          return { ok: (await cdp.eval('document.querySelector(".bili-preview") != null')) === true, value: true }
        } catch {
          return { ok: false }
        }
      }, 20000)
      await sleep(1200) // cover data URL decode
      await cdp.shot(shotName('b2-preview-light'))

      const startQr = `(() => {
        const btn = document.querySelector('.bili-dialog-card .bili-import-btn')
        if (btn == null) return false
        btn.click()
        return true
      })()`
      if ((await cdp.eval(startQr)) !== true) throw new Error('QR login click failed')
      await waitFor('bili qr card', async () => {
        try {
          return { ok: (await cdp.eval('document.querySelector(".bili-qr") != null')) === true, value: true }
        } catch {
          return { ok: false }
        }
      }, 20000)
      await sleep(1500) // QR dataURL render
      await cdp.shot(shotName('b3-qr-light'))

      await cdp.eval('document.documentElement.dataset.theme = "dark"')
      await sleep(400)
      await cdp.shot(shotName('b4-preview-dark'))
      await cdp.eval('document.documentElement.dataset.theme = "light"')
      await sleep(300)
      return
    }

    // --my-study (批4, plan 2026-09-20, P9/D5): 「我的学习」全屏弹层。走真实入口
    // 键打开（与 Ctrl+M 同一个状态），不注入任何状态；light/dark 各一张。
    if (process.argv.includes('--my-study')) {
      const opened = await cdp.eval(`(() => {
        const btn = document.querySelector('[data-testid="my-study-open"]')
        if (btn == null) return false
        btn.click()
        return true
      })()`)
      if (opened !== true) throw new Error('my-study entry button not found')
      await waitFor('my study dialog', async () => {
        try {
          return { ok: (await cdp.eval("document.querySelector('[data-testid=\"my-study-dialog\"]') != null")) === true, value: true }
        } catch {
          return { ok: false }
        }
      }, 15000)
      // 展开第一门课：课时行也入镜（弹层的价值正是侧栏装不下的那些行）。
      await cdp.eval(`(() => {
        const head = document.querySelector('[data-testid="my-study-dialog"] .course-head')
        if (head == null) return false
        head.click()
        return true
      })()`)
      await sleep(500)
      await cdp.shot(shotName('m1-my-study-light'))
      // 关键数字（提交信息取这里）：卡尺寸 / 视口 / 标题字号 / 课程行数。
      const geom = await cdp.eval(`(() => {
        const card = document.querySelector('[data-testid="my-study-dialog"]')
        const head = card.querySelector('.study-panel-head h3')
        const box = card.getBoundingClientRect()
        return {
          cardW: Math.round(box.width), cardH: Math.round(box.height),
          vw: innerWidth, vh: innerHeight,
          headFontPx: Math.round(parseFloat(getComputedStyle(head).fontSize)),
          courseRows: card.querySelectorAll('.course-head').length
        }
      })()`)
      console.log(`my-study dialog: ${JSON.stringify(geom)}`)

      await cdp.eval('document.documentElement.dataset.theme = "dark"')
      await sleep(500)
      await cdp.shot(shotName('m2-my-study-dark'))
      await cdp.eval('document.documentElement.dataset.theme = "light"')
      await sleep(300)
      return
    }

    await cdp.shot(shotName('01-tasks-initial'))

    // 2. expand the first course that has a lesson with a note (badge.ok), select that lesson
    // Idempotent course walk: persisted UI state may already have a course
    // expanded, so blind toggle-clicks collapse instead of expand. Track the
    // tried index on window; collapse strays before opening the current one.
    let notedClicked = false
    for (let attempt = 0; attempt < 30 && !notedClicked; attempt++) {
      const stepped = await cdp.eval(`(() => {
        if (window.__shotHeadIdx == null) window.__shotHeadIdx = 0
        const heads = [...document.querySelectorAll('.sidebar .course-head')]
        for (const h of heads) {
          if (h.getAttribute('aria-expanded') === 'true' && heads.indexOf(h) !== window.__shotHeadIdx) h.click()
        }
        const head = heads[window.__shotHeadIdx]
        if (head == null) return 'exhausted'
        if (head.getAttribute('aria-expanded') !== 'true') head.click()
        return 'ok'
      })()`)
      if (stepped === 'exhausted') break
      await sleep(250)
      notedClicked =
        (await cdp.eval(`(() => {
          const noted = document.querySelector('.sidebar .lesson-row:not(.empty) .badge.ok')
          if (noted != null) { noted.closest('.lesson-row').click(); return true }
          return false
        })()`)) === true
      if (!notedClicked) {
        // no noted lesson in this course — move to the next course head
        await cdp.eval('window.__shotHeadIdx = (window.__shotHeadIdx ?? 0) + 1')
        await sleep(150)
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
    // 批D: fold the first collapsible node and shoot the collapsed state.
    // (SVG elements have no .click() — dispatch the event preact listens for.)
    const folded = await cdp.eval(`(() => {
      const node = document.querySelector('.mindmap-node[role="button"]')
      if (node == null) return false
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    })()`)
    if (folded) {
      await sleep(500)
      await cdp.shot(shotName('04b-note-思维导图-折叠'))
      await cdp.eval(`(() => { document.querySelector('.mindmap-node[role="button"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`)
      await sleep(400)
    }

    // 4. note page with the qa dock + settings
    // P42 (plan 2026-09-22): 「追问」tab 已删（P36）——坞只在笔记页渲染。旧代码
    // goTab('追问') 找不到按钮、静默 no-op，05-qa 拍的其实是上一屏的思维导图视图，
    // 名不副实；改为回到详细笔记视图，拍「带追问小卡片的笔记页」（总张数不变）。
    await goNoteView('详细笔记')
    await sleep(700)
    await cdp.shot(shotName('05-note-dock'))
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

    // --compliance (plan 2026-09-11): 这批新增的四个界面。
    // Reuses the walk above, so a noted lesson is already selected by the time
    // we reach the export step (the notice needs an export button on screen).
    if (process.argv.includes('--compliance')) {
      // The walk above ends in the dark override — pin light for the first half.
      await applyTheme('light')
      const waitForSel = (label, selector, timeout = 8000) =>
        waitFor(label, async () => {
          try {
            return { ok: (await cdp.eval(`document.querySelector(${JSON.stringify(selector)}) != null`)) === true }
          } catch {
            return { ok: false }
          }
        }, timeout)
      // Direct scroller math: the settings page scrolls inside an ancestor, and
      // scrollIntoView({block:'start'}) turned out to be a no-op there.
      const scrollTo = (selector) =>
        cdp.eval(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)})
          if (el == null) return JSON.stringify({ found: false })
          let scroller = el.parentElement
          while (scroller != null && scroller !== document.body) {
            const style = getComputedStyle(scroller)
            if ((style.overflowY === "auto" || style.overflowY === "scroll") && scroller.scrollHeight > scroller.clientHeight + 4) break
            scroller = scroller.parentElement
          }
          if (scroller == null || scroller === document.body) {
            el.scrollIntoView({ block: "center" })
            return JSON.stringify({ found: true, fallback: true })
          }
          const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
          scroller.scrollTop += delta - 12
          return JSON.stringify({ found: true, scrollTop: Math.round(scroller.scrollTop) })
        })()`)

      // 批3: 设置 → 关于与声明（批6 的反馈二维码区块也在其中）
      await goTab('设置')
      await sleep(600)
      await scrollTo('[data-testid="about-panel"]')
      await sleep(400)
      await cdp.shot(shotName('c2-about-light'))
      await scrollTo('[data-testid="feedback-block"]')
      await sleep(400)
      await cdp.shot(shotName('c3-feedback-qr-light'))

      // 两份全文：使用须知走渲染，第三方许可走原文
      if ((await clickByText(cdp, '[data-testid="about-panel"] button', '查看使用须知全文')) !== true) throw new Error('disclaimer entry not found')
      await waitForSel('disclaimer dialog', '[data-testid="legal-disclaimer"]')
      await sleep(400)
      await cdp.shot(shotName('c4-disclaimer-light'))
      if ((await clickByText(cdp, '.dialog-actions button', '关闭')) !== true) throw new Error('disclaimer close failed')
      await sleep(350)
      if ((await clickByText(cdp, '[data-testid="about-panel"] button', '第三方许可')) !== true) throw new Error('licenses entry not found')
      await waitForSel('licenses dialog', '[data-testid="legal-licenses"]')
      await sleep(400)
      await cdp.shot(shotName('c5-licenses-light'))
      if ((await clickByText(cdp, '.dialog-actions button', '关闭')) !== true) throw new Error('licenses close failed')
      await sleep(300)

      // 暗色重拍：白底二维码卡片是这批唯一「外来」视觉，重点看它
      await applyTheme('dark')
      await sleep(450)
      await scrollTo('[data-testid="about-panel"]')
      await sleep(350)
      await cdp.shot(shotName('c8-about-dark'))
      await clickByText(cdp, '[data-testid="about-panel"] button', '查看使用须知全文')
      await waitForSel('disclaimer dialog (dark)', '[data-testid="legal-disclaimer"]')
      await sleep(400)
      await cdp.shot(shotName('c9-disclaimer-dark'))
      await clickByText(cdp, '.dialog-actions button', '关闭')
      await sleep(300)
      await scrollTo('[data-testid="feedback-block"]')
      await sleep(400)
      await cdp.shot(shotName('c10-feedback-qr-dark'))
      await applyTheme('light')
      await sleep(350)

      // 批4: 导出前的版权提醒（屏幕上得有一个可点的导出按钮）
      await goTab('笔记')
      await sleep(900)
      if ((await clickByText(cdp, '.note-toolbar button', '导出 Markdown')) !== true) {
        throw new Error('no export button on screen — the walk did not land on a noted lesson')
      }
      await waitFor('copyright notice', async () => {
        try {
          return { ok: (await cdp.eval('document.body.textContent.includes("导出提醒")')) === true }
        } catch {
          return { ok: false }
        }
      }, 8000)
      await sleep(400)
      await cdp.shot(shotName('c6-export-notice-light'))
      await applyTheme('dark')
      await sleep(450)
      await cdp.shot(shotName('c7-export-notice-dark'))
      await applyTheme('light')
      await sleep(300)
      // Cancel — this run must not write an export file nobody asked for.
      if ((await clickByText(cdp, '.dialog-actions button', '取消')) !== true) throw new Error('notice cancel failed')
      await sleep(400)

      // 批6: 失败任务的诊断弹层（真实库里有失败任务可点）。
      // 必须先回首页：有课时被选中时任务页只渲染「本课时历史任务」，而那几条
      // 失败任务属于别的课时——全局列表才看得到它们。
      await cdp.eval('(() => { document.querySelector(".brand")?.click(); return true })()')
      await sleep(500)
      await goTab('任务')
      await sleep(900)
      const reportClicked = await cdp.eval(
        '(() => { const b = document.querySelector("[data-testid=\'report-error\']"); if (b == null) return false; b.click(); return true })()'
      )
      if (reportClicked === true) {
        await waitForSel('diagnostics dialog', '[data-testid="feedback-diagnostics"]')
        await sleep(500)
        await cdp.shot(shotName('c11-diagnostics-light'))
        await applyTheme('dark')
        await sleep(450)
        await cdp.shot(shotName('c12-diagnostics-dark'))
        await applyTheme('light')
        await clickByText(cdp, '.dialog-actions button', '关闭')
      } else {
        console.log('note  no failed-task row visible — skipped the diagnostics shots')
      }
      return
    }

    await cdp.eval('delete document.documentElement.dataset.theme')
  } finally {
    killApp(electron)
    await removeDir(tmpDocs)
  }
  console.log(`\nDONE → ${outDir}`)
}

await main()
