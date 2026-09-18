import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SUBJECT_INKS, subjectInk, subjectInkVar } from '../src/shared/subject-ink'

const css = readFileSync(join(__dirname, '..', 'src/renderer/style.css'), 'utf8')

/** WCAG 相对亮度与对比度（与 style.css 注释同口径）。 */
function luminance(hex: string): number {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(parseInt(hex.slice(1, 3), 16)) + 0.7152 * channel(parseInt(hex.slice(3, 5), 16)) + 0.0722 * channel(parseInt(hex.slice(5, 7), 16))
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 某一处 token 定义的字面值（第一个匹配）。 */
function tokenValue(name: string): string | null {
  const m = new RegExp(name + ': *([^;]+);').exec(css)
  return m == null ? null : m[1].trim()
}

/** 同名 token 的所有十六进制取值（浅色一处 + 暗色两处）。 */
function hexValues(name: string): string[] {
  const out: string[] = []
  const re = new RegExp(name + ': *(#[0-9a-fA-F]{6});', 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) != null) out.push(m[1])
  return out
}

describe('subjectInk (V2 书脊学科墨水)', () => {
  it('returns a member of the closed six-ink palette', () => {
    for (const id of ['1690625', '1691584', '1', '9999999', 'x', '']) {
      expect(SUBJECT_INKS).toContain(subjectInk(id))
    }
  })

  it('is deterministic: the same id always wears the same ink', () => {
    for (const id of ['1690625', '42', 'Python语言设计']) {
      expect(subjectInk(id)).toBe(subjectInk(id))
    }
  })

  it('spreads distinct ids across more than one hue', () => {
    const inks = new Set(Array.from({ length: 60 }, (_, i) => subjectInk(`course-${i}`)))
    expect(inks.size).toBeGreaterThan(3)
  })
})

describe('学科墨水的主题 token（批8）', () => {
  it('CSS 浅色 token 与 SUBJECT_INKS 逐值一致（值只有一份定义，靠这条守卫不漂移）', () => {
    SUBJECT_INKS.forEach((ink, i) => {
      expect(tokenValue(`--subject-ink-${i + 1}`), `--subject-ink-${i + 1} 必须等于 SUBJECT_INKS[${i}]`).toBe(ink)
    })
  })

  it('暗色两处入口都定义了 6 个学科色，且对暗面 --surface 的对比度 ≥4.5', () => {
    const darkSurface = '#171b19'
    for (let i = 1; i <= 6; i++) {
      const values = hexValues(`--subject-ink-${i}`)
      // 浅色一处 + 暗色两处 = 3 处定义。
      expect(values, `--subject-ink-${i} 应有 3 处定义（浅色 + 两处暗色）`).toHaveLength(3)
      const [light, darkA, darkB] = values
      expect(darkA, '两处暗色入口必须同值').toBe(darkB)
      expect(darkA, `--subject-ink-${i} 的暗色值必须与浅色值不同`).not.toBe(light)
      const ratio = contrast(darkA!, darkSurface)
      expect(ratio, `--subject-ink-${i} 在暗面上只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('subjectInkVar 只给变量名（切主题不需要 JS 参与）', () => {
    for (const id of ['1690625', '42', 'Python语言设计']) {
      expect(subjectInkVar(id)).toMatch(/^var\(--subject-ink-[1-6]\)$/)
    }
    // 与 subjectInk 指向同一个色位。
    const id = '1690625'
    const index = SUBJECT_INKS.indexOf(subjectInk(id))
    expect(subjectInkVar(id)).toBe(`var(--subject-ink-${index + 1})`)
  })
})
