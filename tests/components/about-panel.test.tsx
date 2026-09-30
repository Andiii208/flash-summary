import { describe, expect, it, vi } from 'vitest'
import { mount, click } from '../helpers/preact'
import { AboutPanel } from '../../src/renderer/components/AboutPanel'
import { DISCLAIMER_TEXT_VERSION } from '../../src/shared/disclaimer'

/**
 * 声明批3（plan 2026-09-11 compliance-disclosure）: 设置页「关于与声明」面板。
 *
 * 这一块是声明层里**常驻可查**的那一半（首启闸门是一次性的）。测的是：两项
 * 内容真的能打开、显示的是随包文件的原文而不是别的副本、并且没有把 markdown
 * 标记原样印给用户（使用须知走渲染，许可声明走原文 `<pre>`）。
 */

function buttonByText(label: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll('.about-actions button')) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent === label) ?? null
}

describe('设置页「关于与声明」面板', () => {
  it('显示版本号与使用须知文本版本，并有非官方与数据流向两段说明', () => {
    mount(<AboutPanel version="9.9.9" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('v9.9.9')
    expect(text).toContain(`使用须知第 ${DISCLAIMER_TEXT_VERSION} 版`)
    // 非官方声明与数据流向是这一块存在的理由，不能只剩两个按钮。
    expect(text).toContain('东南大学')
    expect(text).toContain('哔哩哔哩')
    expect(text).toContain('你自己配置')
    expect(text).toContain('不上报任何数据')
  })

  it('版本未知时不印出半截「vundefined」', () => {
    mount(<AboutPanel />)
    expect(document.body.textContent).not.toContain('vundefined')
  })

  it('「查看使用须知全文」打开渲染后的全文（不是 markdown 原文）', () => {
    mount(<AboutPanel version="1.0.0" />)
    expect(document.querySelector('[data-testid="legal-disclaimer"]')).toBeNull()

    click(buttonByText('查看使用须知全文'))
    const view = document.querySelector('[data-testid="legal-disclaimer"]')
    expect(view).not.toBeNull()
    // 走 MdLite 渲染：正文以真实节点出现，且**不残留 markdown 标记**。
    // 标题按 md-h 类断言而不是具体 hN——MdLite 会把标题降级（h1/h2 → h4/h5）。
    const headings = Array.from(view?.querySelectorAll('.md-h') ?? []).map((node) => node.textContent ?? '')
    expect(headings.some((heading) => heading.includes('非官方声明'))).toBe(true)
    const text = view?.textContent ?? ''
    expect(text).not.toContain('**')
    expect(text).not.toContain('##')
    expect(text).not.toContain('](')
    // 九节的正文都得在（不能只渲染出标题骨架）。
    expect(text).toContain('Windows DPAPI')
    // 2026-09-11 双主题走查实拍的三个问题：标题重复 + 维护者说明 + 字面 `---`。
    // 标题由弹窗负责，正文里不该再出现一次。
    expect(headings.filter((heading) => heading.includes('使用须知与免责声明'))).toHaveLength(0)
    // 这份文档是写给仓库读者的，「改本文件前先同步 disclaimer.ts」对用户毫无意义。
    expect(text).not.toContain('disclaimer.ts')
    expect(text).not.toContain('本文件是唯一文本源')
    expect(text).not.toContain('---')
  })

  it('「第三方许可」渲染成真表格（骨架是表格，印原文只会是一堆竖线）', () => {
    mount(<AboutPanel version="1.0.0" />)
    click(buttonByText('第三方许可'))

    const view = document.querySelector('[data-testid="legal-licenses"]')
    expect(view).not.toBeNull()
    const text = view?.textContent ?? ''
    expect(text).toContain('GPL-3.0')
    expect(text).toContain('ffmpeg')
    // 源码获取途径是 GPL 合规的要件，不是可选文案。
    expect(text).toContain('ffmpeg.org')
    expect(text).toContain('LICENSES/')
    // 表格落成 table 节点，而不是 `| a | b |` 那种原文。
    const table = view?.querySelector('table.md-table')
    expect(table).not.toBeNull()
    expect(table?.querySelectorAll('th').length).toBeGreaterThan(0)
    expect(table?.querySelectorAll('tbody tr').length).toBeGreaterThan(0)
    // 单元格内容真的进了表格（不是只画了个空壳）。
    expect(table?.textContent ?? '').toContain('GPL-3.0')
    expect(text).not.toContain('| ---')
  })

  it('两个弹层互斥：打开许可时不显示使用须知，反之亦然', () => {
    mount(<AboutPanel version="1.0.0" />)
    click(buttonByText('查看使用须知全文'))
    expect(document.querySelector('[data-testid="legal-licenses"]')).toBeNull()

    // 视图弹层只有一个「关闭」动作；Esc 也走同一条关闭路径（非 persistent）。
    click(document.querySelector('.dialog-actions button'))
    expect(document.querySelector('[data-testid="legal-disclaimer"]')).toBeNull()

    click(buttonByText('第三方许可'))
    expect(document.querySelector('[data-testid="legal-disclaimer"]')).toBeNull()
    expect(document.querySelector('[data-testid="legal-licenses"]')).not.toBeNull()
  })

  // 2026-09-21: 作者 GitHub 主页入口。红线与反馈表同款——地址只在 main 侧，
  // 渲染层只拿到一个**无参回调**，DOM 里不该出现任何 URL。
  it('作者入口：给了回调才渲染，点击走无参回调，且 DOM 里没有地址', () => {
    const opened = vi.fn()
    mount(<AboutPanel version="1.0.0" onOpenAuthor={opened} />)
    const button = document.querySelector('[data-testid="open-author-github"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    expect(button?.textContent ?? '').toContain('GitHub')
    expect(document.body.textContent ?? '').not.toContain('github.com')
    click(button)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('作者入口：没给回调就不渲染（与反馈按钮同款条件渲染）', () => {
    mount(<AboutPanel version="1.0.0" />)
    expect(document.querySelector('[data-testid="open-author-github"]')).toBeNull()
  })

  // 2026-09-30 (plan 2026-09-30-public-release-autoupdate): 更新区块。
  it('更新：没接线就不渲染；接线后 idle 显示来源说明与「检查更新」', () => {
    mount(<AboutPanel version="1.2.3" />)
    expect(document.querySelector('[data-testid="update-block"]')).toBeNull()

    mount(
      <AboutPanel
        version="1.2.3"
        update={{ state: { phase: 'idle' }, onCheck: () => undefined, onDownload: () => undefined, onInstall: () => undefined, onDismiss: () => undefined }}
      />
    )
    expect(document.querySelector('[data-testid="update-block"]')).not.toBeNull()
    expect(document.body.textContent ?? '').toContain('GitHub Releases')
    const button = document.querySelector('[data-testid="check-update"]') as HTMLButtonElement | null
    expect(button?.textContent).toBe('检查更新')
    expect(button?.disabled).toBe(false)
  })

  it('更新：检查中点按钮 = 「检查中…」+ disabled（busy 三件套）', () => {
    mount(
      <AboutPanel
        update={{ state: { phase: 'checking' }, onCheck: () => undefined, onDownload: () => undefined, onInstall: () => undefined, onDismiss: () => undefined }}
      />
    )
    const button = document.querySelector('[data-testid="check-update"]') as HTMLButtonElement | null
    expect(button?.textContent).toBe('检查中…')
    expect(button?.disabled).toBe(true)
  })

  it('更新：发现新版本弹层带版本号，确认走 onDownload，DOM 不含任何地址', () => {
    const onDownload = vi.fn()
    mount(
      <AboutPanel
        update={{ state: { phase: 'available', version: '9.9.9' }, onCheck: () => undefined, onDownload, onInstall: () => undefined, onDismiss: () => undefined }}
      />
    )
    const dialog = document.querySelector('.dialog')
    expect(dialog?.textContent ?? '').toContain('发现新版本 v9.9.9')
    expect(document.body.textContent ?? '').not.toContain('github.com')
    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find((b) => b.textContent === '下载并安装')
    expect(confirm).not.toBeUndefined()
    click(confirm ?? null)
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('更新：下载中按钮显示百分比且禁用', () => {
    mount(
      <AboutPanel
        update={{ state: { phase: 'downloading', version: '9.9.9', percent: 42 }, onCheck: () => undefined, onDownload: () => undefined, onInstall: () => undefined, onDismiss: () => undefined }}
      />
    )
    const button = document.querySelector('[data-testid="check-update"]') as HTMLButtonElement | null
    expect(button?.textContent).toBe('下载中… 42%')
    expect(button?.disabled).toBe(true)
  })

  it('更新：下载完成后「立即重启安装」走 onInstall，「稍后」走 onDismiss', () => {
    const onInstall = vi.fn()
    const onDismiss = vi.fn()
    mount(
      <AboutPanel
        update={{ state: { phase: 'downloaded', version: '9.9.9', downloaded: '9.9.9' }, onCheck: () => undefined, onDownload: () => undefined, onInstall, onDismiss }}
      />
    )
    const dialog = document.querySelector('.dialog')
    click(Array.from(dialog?.querySelectorAll('button') ?? []).find((b) => b.textContent === '立即重启安装') ?? null)
    expect(onInstall).toHaveBeenCalledTimes(1)
    click(Array.from(dialog?.querySelectorAll('button') ?? []).find((b) => b.textContent === '稍后') ?? null)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
