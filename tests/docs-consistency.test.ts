import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * 文档收口对齐的可执行检查（方案 docs/plans/2026-09-20-ux-issues-remediation.md §4
 * 「整体」验收项：README/CHANGELOG 在最后一批收口时对齐）。
 *
 * 背景（2026-09-21 独立审计）：README 停在「1268 个用例，123 个文件」，而当时的
 * HEAD 实测是 1377 / 130——批1–批6 六批的测试增长一条都没进 README，而这条验收项
 * 此前**没有任何可执行检查**（`grep -rn "README.md" tests/ scripts/` 零命中）。
 * 数字声明是「台账里的全称命题」，按 AGENTS.md 的纪律必须能核对，所以这里把它钉住。
 *
 * 计数口径与台账一致：`^\s*(it|test)(\.(each|skip|only))?\(` 在 tests/** 下的声明数
 * ——实测与 vitest 报告的用例数逐条相等（HEAD 实测 1377 / 130，vitest 报 1377/130），
 * 所以静态计数就是那个数，不必在测试里跑测试。只增不减的纪律由它顺手兜住：数字掉了
 * 一定是删了用例。
 */
const ROOT = join(__dirname, '..')
const DECLARATION = /^\s*(it|test)(\.(each|skip|only))?\(/

/** 递归收集 tests/ 下的测试文件（vitest include 同款：tests/**\/*.test.{ts,tsx}）。 */
function testFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (/\.test\.tsx?$/.test(entry)) found.push(full)
    }
  }
  walk(join(ROOT, 'tests'))
  return found
}

/** 静态声明数 + 文件数（与 `git grep -h -E … | wc -l` 同一口径）。 */
function countTests(): { cases: number; files: number } {
  const files = testFiles()
  let cases = 0
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (DECLARATION.test(line)) cases += 1
    }
  }
  return { cases, files: files.length }
}

describe('文档收口对齐（批6 §4「整体」验收项）', () => {
  const { cases, files } = countTests()

  it('README 的测试数与文件数 = tests/ 的实测计数（收口时不许留旧数字）', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    // 四处声明：技术栈行、项目结构行、实测行、命令注释——数字必须一致且等于实测。
    // 「个测试文件」是文件数声明，用负向前瞻把它从用例声明里排掉。
    const caseClaims = [...readme.matchAll(/(\d[\d,]*)\s*(?:个用例|个测试(?!文件)|用例)/g)].map((m) => Number(m[1]!.replace(/,/g, '')))
    const fileClaims = [...readme.matchAll(/(\d+)\s*个(?:测试)?文件|(\d+)\s*文件/g)].map((m) => Number(m[1] ?? m[2]))
    expect(caseClaims.length, 'README 里应至少有两处测试数声明').toBeGreaterThanOrEqual(2)
    expect(fileClaims.length, 'README 里应至少有两处文件数声明').toBeGreaterThanOrEqual(2)
    // 失败信息里直接给出该写什么，省掉「红了但不知道改成几」的一轮。
    expect(caseClaims, `README 的测试数应统一为 ${cases}`).toEqual(caseClaims.map(() => cases))
    expect(fileClaims, `README 的文件数应统一为 ${files}`).toEqual(fileClaims.map(() => files))
  })

  it('CHANGELOG 的最新一节要么是 [未发布]、要么与 package.json 的版本一致', () => {
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version
    const top = changelog.match(/^## \[([^\]]+)\]/m)?.[1]
    expect(top, 'CHANGELOG 应有版本节').toBeDefined()
    // 「未发布」是有未收编工作的显式标记；一旦发版，收编后的节标题就是 package.json
    // 的版本——两种都算对齐，停在更早的版本号则说明 CHANGELOG 落后了。
    expect([ '未发布', version ]).toContain(top)
  })
})
