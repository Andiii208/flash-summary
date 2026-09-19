#!/usr/bin/env node
/**
 * 批8 (plan 2026-09-19): 打印 style.css 当前的 padding 野值清单，供维护者复制进
 * tests/style-scale.test.ts 的 KNOWN_PADDING_VIOLATIONS allowlist。
 *
 * 背景：ui-layout SKILL 的纪律本来含「padding 走 --space-* 刻度」，但历史上攒了
 * 一批野值，一刀切会制造大片红。务实路径 = 基线 allowlist「只减不增」：现在有什么
 * 就记什么，此后新增野值即测试红（跑本脚本即可拿到新清单），修掉一条就从
 * allowlist 删一条。
 *
 * 用法：node scripts/style-padding-baseline.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cssPath = join(repoRoot, 'src/renderer/style.css')
const css = readFileSync(cssPath, 'utf8')

/** 去掉注释（保留换行，便于报行号）。 */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

function lineOf(index) {
  let line = 1
  for (let i = 0; i < index; i++) if (css[i] === '\n') line++
  return line
}

/** 该值是否完全由 --space-* 刻度 token（或 0）组成。 */
function isOnScale(value) {
  return value.split(/\s+/).every((p) => /^var\(--space-[a-z0-9-]+\)$/.test(p) || p === '0')
}

/** 某条 padding 声明所在块的选择器（报错时可读性用）。 */
function selectorAt(index) {
  const before = stripped.slice(0, index)
  const lastBrace = before.lastIndexOf('}')
  return before
    .slice(lastBrace + 1)
    .split('{')[0]
    .replace(/\s+/g, ' ')
    .trim()
}

const DECL = /\bpadding(-top|-right|-bottom|-left|-block|-inline|-block-start|-block-end|-inline-start|-inline-end)?\s*:\s*([^;}]+)/g
const byValue = new Map()
let m
while ((m = DECL.exec(stripped)) != null) {
  const value = m[2].trim()
  if (isOnScale(value)) continue
  const where = `${selectorAt(m.index)} @ style.css:${lineOf(m.index)}`
  if (!byValue.has(value)) byValue.set(value, [])
  byValue.get(value).push(where)
}

if (byValue.size === 0) {
  console.log('当前 style.css 没有 padding 野值——allowlist 可以清空了（删 KNOWN_PADDING_VIOLATIONS 全部条目）。')
  process.exit(0)
}

const total = [...byValue.values()].reduce((acc, list) => acc + list.length, 0)
console.log(`当前 padding 野值：${total} 处 / ${byValue.size} 个唯一值。复制下面进 tests/style-scale.test.ts 的 KNOWN_PADDING_VIOLATIONS（键 = 值，注释写清归属），并为每条补备注：\n`)
for (const [value, wheres] of [...byValue.entries()].sort()) {
  console.log(`  '${value}': '…归属/批号…', // ${wheres.length} 处，如 ${wheres.slice(0, 2).join('；')}`)
}
