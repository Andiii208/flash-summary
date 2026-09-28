/**
 * 批7 (audit 2026-09-28, H13): 假桥面与真桥面**逐键钉死**。
 *
 * `tests/helpers/fake-app-bridge.ts` 曾经用 `as unknown as SeuSummaryBridge`
 * 把整个对象伪装成桥面——fake 缺方法、多方法都编译通过，于是「测试侧看不到桥面
 * 形状」（2026-09-18 批C1 的同类残留：四门禁全绿而 smoke 报漂移）。标注降级后
 * TS 已经能抓签名漂移，但**键集合**（多一个整组、少一个整组）在结构类型下仍可能
 * 悄悄失守，所以这里再用源码解析把三份列表钉成一份：
 *
 *   1. src/shared/bridge.ts          —— 唯一事实源（解析 group→interface→methods）
 *   2. scripts/smoke-cdp.mjs 的 EXPECTED_BRIDGE —— CDP smoke 的同款清单
 *   3. makeBridge()                  —— 组件测试实际拿到的假实现
 *
 * 任何一份与另两份不一致，这里红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { makeBridge } from './helpers/fake-app-bridge'

const ROOT = join(__dirname, '..')

/** 仓库源文件是 CRLF，统一折成 LF 再解析（否则按行/字符串收尾的匹配全失灵）。 */
function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

/** group 名 → 该组接口里的方法名（按 bridge.ts 的书写顺序，排序后比较）。 */
function parseBridgeGroups(): Record<string, string[]> {
  const source = readSource('src/shared/bridge.ts')
  // SeuSummaryBridge 的每个属性形如 `school: SchoolBridge,`（可能带行注释）。
  const groups = new Map<string, string>()
  const groupRegex = /^\s{2}(\w+): (\w+Bridge),?\s*$/gm
  let match: RegExpExecArray | null
  while ((match = groupRegex.exec(source)) != null) groups.set(match[1], match[2])
  expect(groups.size, 'SeuSummaryBridge 的最小分组成员数').toBeGreaterThanOrEqual(10)

  const out: Record<string, string[]> = {}
  for (const [group, iface] of groups) {
    const body = extractInterfaceBody(source, iface)
    // 方法签名行以两个空格缩进、`name(` 开头；属性行（如 `x: T`）不是方法。
    const methods = [...body.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1])
    out[group] = methods
  }
  return out
}

/** 取出 `export interface <name> {` 到配对右花括号之间的正文。 */
function extractInterfaceBody(source: string, name: string): string {
  const start = source.indexOf(`export interface ${name} {`)
  expect(start, `接口 ${name} 未在 bridge.ts 中找到`).toBeGreaterThanOrEqual(0)
  const bodyStart = source.indexOf('{', start)
  let depth = 0
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}') {
      depth--
      if (depth === 0) return source.slice(bodyStart + 1, index)
    }
  }
  throw new Error(`接口 ${name} 的花括号不配对`)
}

/** smoke-cdp.mjs 的 EXPECTED_BRIDGE 常量——同款 group→methods 清单。 */
function parseSmokeExpectedBridge(): Record<string, string[]> {
  const source = readSource('scripts/smoke-cdp.mjs')
  const start = source.indexOf('const EXPECTED_BRIDGE = {')
  expect(start, 'EXPECTED_BRIDGE 未在 smoke-cdp.mjs 中找到').toBeGreaterThanOrEqual(0)
  const stop = source.indexOf('\n}\n', start)
  expect(stop, 'EXPECTED_BRIDGE 的字面量没有正常收尾').toBeGreaterThan(start)
  const literal = source.slice(start, stop)
  const out: Record<string, string[]> = {}
  // 组行：`  school: ['login', 'logout', ...]`（注释行天然不匹配）。
  for (const line of literal.split('\n')) {
    const group = /^\s{2}(\w+): \[([^\]]*)\]/.exec(line)
    if (group == null) continue
    out[group[1]] = [...group[2].matchAll(/'(\w+)'/g)].map((m) => m[1])
  }
  return out
}

function sortMap(map: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v].sort()]))
}

describe('批7 (H13): fake bridge 与真桥面逐键一致', () => {
  it('bridge.ts 解析出的方法与各接口成员数量一致（解析器自身没失灵）', () => {
    const groups = parseBridgeGroups()
    // 每组至少 1 个方法：解析到空数组说明正则或花括号配对出了问题（lessons 整组
    // 只有 openSource 一个方法，那是真实形状，不是解析失败）。
    for (const [group, methods] of Object.entries(groups)) {
      expect(methods.length, `${group} 解析到的方法数`).toBeGreaterThanOrEqual(1)
    }
    expect(Object.keys(groups).sort()).toEqual(
      ['bilibili', 'feedback', 'lessons', 'log', 'notes', 'providers', 'qa', 'school', 'settings', 'tasks'].sort()
    )
  })

  it('makeBridge() 的 group/method 键集合与 bridge.ts 完全一致（多一个少一个都红）', () => {
    const actual = sortMap(Object.fromEntries(Object.entries(makeBridge()).map(([group, api]) => [group, Object.keys(api)])))
    expect(actual).toEqual(sortMap(parseBridgeGroups()))
  })

  it('smoke-cdp.mjs 的 EXPECTED_BRIDGE 同样与 bridge.ts 逐键一致', () => {
    expect(sortMap(parseSmokeExpectedBridge())).toEqual(sortMap(parseBridgeGroups()))
  })

  it('tasks 组没有幽灵方法 run（真桥面只有 runAsync）', () => {
    expect(Object.keys(makeBridge().tasks)).not.toContain('run')
    expect(Object.keys(makeBridge().tasks)).toContain('runAsync')
  })
})
