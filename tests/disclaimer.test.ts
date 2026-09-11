import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  DISCLAIMER_CONSENT_CLAUSES,
  DISCLAIMER_CONSENT_CHECK_LABEL,
  DISCLAIMER_CONSENT_PROMPT,
  DISCLAIMER_TEXT_VERSION,
  DISCLAIMER_TITLE
} from '../src/shared/disclaimer'

/**
 * 声明批2（plan 2026-09-11 compliance-disclosure）: 钉住测试。
 *
 * 元纪律「设计声明与实现漂移」的守卫。用户可见的声明是**承诺**：版本号、条款数、
 * 措辞纪律、随包分发的第三方清单，改一处不改另一处都必须红。
 *
 * 注意这些断言测的是「机制与纪律」，不是具体字句——文案迭代可以自由改字，
 * 但上面四类事实改坏了会被这里拦住。
 */

const repoRoot = join(__dirname, '..')
const read = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8')

describe('使用须知文本（声明批2）', () => {
  it('文本版本号与 DISCLAIMER.md 的 `文本版本` 行一致', () => {
    const md = read('DISCLAIMER.md')
    const matched = md.match(/文本版本：\*\*(\d+)\*\*/)
    expect(matched, 'DISCLAIMER.md 必须含 `> 文本版本：**N**` 行').not.toBeNull()
    // 漂移守卫：改了条款就要同时动这两个地方，只动一处会红。
    expect(Number(matched?.[1])).toBe(DISCLAIMER_TEXT_VERSION)
  })

  it('弹窗精简版九条，且与全文的九节一一对应', () => {
    const sections = read('DISCLAIMER.md').match(/^## \d+\. /gm) ?? []
    expect(sections).toHaveLength(9)
    // 弹窗比全文短，但不多不少覆盖同一批主题——不能悄悄少一条。
    expect(DISCLAIMER_CONSENT_CLAUSES).toHaveLength(9)
    const headings = DISCLAIMER_CONSENT_CLAUSES.map((clause) => clause.heading)
    expect(new Set(headings).size).toBe(headings.length)
  })

  it('每条都非空，且短到能在弹窗里读', () => {
    for (const clause of DISCLAIMER_CONSENT_CLAUSES) {
      expect(clause.heading.length).toBeGreaterThan(0)
      expect(clause.text.length).toBeGreaterThan(10)
      // 「每条不超过两行」的口吻纪律：60 余字在 560px 弹窗里约两行。
      expect(clause.text.length, `${clause.heading} 过长`).toBeLessThanOrEqual(80)
    }
  })

  it('全部用户可见声明文本都不含法律术语（D7 裁决）', () => {
    // 2026-09-11 Andiii 裁决：跨境/出境一律不提——理由是应用不知道用户填的是
    // 境内还是境外服务商，写了就是不成立的断言。
    const banned = ['跨境', '出境', '不可抗力']
    const userVisible = [
      read('DISCLAIMER.md'),
      read('THIRD-PARTY-NOTICES.md'),
      DISCLAIMER_TITLE,
      DISCLAIMER_CONSENT_PROMPT,
      DISCLAIMER_CONSENT_CHECK_LABEL,
      ...DISCLAIMER_CONSENT_CLAUSES.flatMap((clause) => [clause.heading, clause.text])
    ]
    for (const text of userVisible) {
      for (const word of banned) {
        expect(text, `用户可见文本不得出现「${word}」`).not.toContain(word)
      }
    }
    // README 的合规章节同样面向用户（排除本方案文档自身的裁决记录）。
    expect(read('README.md')).not.toContain('跨境')
  })
})

describe('第三方许可清单（声明批1 的随包约定）', () => {
  it('ffmpeg 的 GPL 定性仍然成立——上游若换许可，本测试会提醒改文档', () => {
    const meta = JSON.parse(read('node_modules/ffmpeg-static/package.json')) as { license?: string; version: string }
    // THIRD-PARTY-NOTICES.md 正是按「GPL-3.0」写的（这也是它需要源码要约的原因）。
    expect(meta.license ?? '').toMatch(/^GPL/)
    expect(read('THIRD-PARTY-NOTICES.md')).toContain('GPL-3.0')
    expect(existsSync(join(repoRoot, 'LICENSES', 'GPL-3.0-or-later.txt'))).toBe(true)
    expect(read(join('LICENSES', 'GPL-3.0-or-later.txt'))).toContain('GNU GENERAL PUBLIC LICENSE')
  })

  it('每一个运行时依赖都在 THIRD-PARTY-NOTICES.md 里被提及', () => {
    // AGENTS.md 的声明层纪律：新增运行时依赖必须同步 notices + LICENSES/。
    // 漏了这里就会红——这是那条纪律的自动化形式。
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> }
    const notices = read('THIRD-PARTY-NOTICES.md')
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      expect(notices, `THIRD-PARTY-NOTICES.md 缺少运行时依赖 ${name}`).toContain(name)
    }
  })
})
