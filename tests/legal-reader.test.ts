import { describe, expect, it } from 'vitest'
import { toReaderMarkdown } from '../src/renderer/legal-text'

/**
 * 2026-09-11（声明批3 收口）: 把仓库文档整理成「给人读」的形态。
 *
 * 这几个用例直接对应**双主题截图走查实拍到的问题**——不是凭空设想的边界：
 *  · 弹窗里出现两行「使用须知与免责声明」（弹窗标题 + 文档 H1）
 *  · 「请勿在未同步更新 src/shared/disclaimer.ts 的情况下单独改动本文件」漏给用户
 *  · 字面 `---` 分隔线
 *  · `[label](url)` 原样印出（MdLite 有意不支持链接：CSP 是 self，可点链接会把主窗口导航走）
 */
describe('仓库文档 → 读者版（声明批3 收口）', () => {
  const SAMPLE = [
    '# 使用须知与免责声明',
    '',
    '> 文本版本：**2**（版本号变更后…请勿在未同步更新 `src/shared/disclaimer.ts` 的情况下单独改动本文件）',
    '> 适用范围：Flash Summary Windows 桌面版。',
    '> 本文件是**唯一文本源**——不得各自维护副本。',
    '',
    '---',
    '',
    '## 1. 非官方声明',
    '',
    '见 [`LICENSE`](LICENSE)（MIT）与 [上游](https://example.com/x)。',
    ''
  ].join('\n')

  it('去掉文档自己的 H1（弹窗标题已经说了同一件事）', () => {
    const out = toReaderMarkdown(SAMPLE)
    expect(out).not.toContain('# 使用须知与免责声明')
    // 但小节标题必须留着。
    expect(out).toContain('## 1. 非官方声明')
  })

  it('去掉开头的维护者说明，但不动正文里的引用块', () => {
    const withLaterQuote = `${SAMPLE}\n## 9. 责任限制\n\n> 完整免责条款以 LICENSE 为准。\n`
    const out = toReaderMarkdown(withLaterQuote)
    expect(out).not.toContain('disclaimer.ts')
    expect(out).not.toContain('本文件是**唯一文本源**')
    // 正文里的引用块是内容，不能被一并吃掉。
    expect(out).toContain('> 完整免责条款以 LICENSE 为准。')
  })

  it('去掉字面 --- 分隔线', () => {
    const out = toReaderMarkdown(SAMPLE)
    expect(out.split('\n').some((line) => line.trim() === '---')).toBe(false)
  })

  it('链接降级为纯文本；裸网址（GPL 源码途径那种写法）原样保留', () => {
    const out = toReaderMarkdown(`${SAMPLE}\n源码：<https://ffmpeg.org/download.html>\n`)
    expect(out).not.toContain('](')
    // 标签留下——表格里那些「[gyan.dev](url)」至少还能读出是谁。
    expect(out).toContain('LICENSE')
    // 裸网址必须留下：ffmpeg 的源码获取途径是 GPL 合规要件，丢了就真少告知一件事。
    expect(out).toContain('<https://ffmpeg.org/download.html>')
  })

  it('不留下一连串空行', () => {
    expect(toReaderMarkdown(SAMPLE)).not.toMatch(/\n{3,}/)
  })

  it('真实的两份随包文档都能过一遍且不丢小节', async () => {
    const { DISCLAIMER_FULL_TEXT, THIRD_PARTY_NOTICES_TEXT } = await import('../src/renderer/legal-text')
    const disclaimer = toReaderMarkdown(DISCLAIMER_FULL_TEXT)
    // 九节都在（原文是 `## 1.` … `## 9.`）。
    for (let n = 1; n <= 9; n++) expect(disclaimer, `第 ${n} 节`).toContain(`## ${n}. `)
    expect(disclaimer).not.toContain('](')

    const notices = toReaderMarkdown(THIRD_PARTY_NOTICES_TEXT)
    expect(notices).toContain('GPL-3.0')
    expect(notices).toContain('ffmpeg')
    expect(notices).not.toContain('](')
    // 表格的分隔行要原样留着交给解析器（不能被当成分隔线删掉）。
    expect(notices).toContain('|---|')
  })
})
