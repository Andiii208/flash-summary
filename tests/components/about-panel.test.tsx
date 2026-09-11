import { describe, expect, it } from 'vitest'
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
    expect(view?.textContent ?? '').not.toContain('**')
    expect(view?.textContent ?? '').not.toContain('##')
    // 九节的正文都得在（不能只渲染出标题骨架）。
    expect(view?.textContent ?? '').toContain('Windows DPAPI')
  })

  it('「第三方许可」按原文展示，含 ffmpeg 的 GPL 说明与源码途径', () => {
    mount(<AboutPanel version="1.0.0" />)
    click(buttonByText('第三方许可'))

    const view = document.querySelector('[data-testid="legal-licenses"]')
    expect(view).not.toBeNull()
    const raw = view?.querySelector('pre.legal-raw')
    expect(raw).not.toBeNull()
    const text = raw?.textContent ?? ''
    expect(text).toContain('GPL-3.0')
    expect(text).toContain('ffmpeg')
    // 源码获取途径是 GPL 合规的要件，不是可选文案。
    expect(text).toContain('ffmpeg.org')
    expect(text).toContain('LICENSES/')
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
})
