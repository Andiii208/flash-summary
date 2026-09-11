import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { Dialog } from '../ui/Dialog'
import { MdLite } from './MdLite'
import { DISCLAIMER_FULL_TEXT, THIRD_PARTY_NOTICES_TEXT } from '../legal-text'
import { DISCLAIMER_TITLE, DISCLAIMER_TEXT_VERSION } from '../../shared/disclaimer'

/**
 * 声明批3（plan 2026-09-11 compliance-disclosure）: the常驻 «关于与声明» block on
 * the settings page. It is the always-available half of the disclosure layer —
 * the first-run gate is one-shot, this one can be re-read at any time.
 *
 * 呈现取两条不同的路，各有理由：
 *  - 使用须知全文走 `MdLite`（该文件只有标题/列表/引用，没有表格，渲染后更好读）；
 *  - 第三方许可走 `<pre>` 原样文本——那份文件的核心是表格，md-lite 会把表格摊成
 *    一堆竖线；而「许可声明」本来就该让人看到与随包文件逐字一致的原文。
 *  两者都只输出 JSX，不碰 innerHTML。
 */
export function AboutPanel({ version }: { version?: string }): JSX.Element {
  const [open, setOpen] = useState<'none' | 'disclaimer' | 'licenses'>('none')
  const close = (): void => setOpen('none')

  return (
    <section class="settings-block" data-testid="about-panel">
      <h3>关于与声明</h3>
      <div class="settings-row">
        <span class="settings-label">版本</span>
        <span class="about-version">
          Flash Summary{version != null ? ` v${version}` : ''}
          <span class="about-text-version"> · 使用须知第 {DISCLAIMER_TEXT_VERSION} 版</span>
        </span>
      </div>
      <p class="about-note">
        本软件由个人开发，与<strong>东南大学</strong>及其信息化部门、与<strong>哔哩哔哩</strong>均无隶属、合作或授权关系。
      </p>
      <p class="about-note">
        音频、视频截图与转写文本会发送到<strong>你自己配置</strong>的模型服务商，其处理与留存以该服务商的条款为准；本软件没有开发者服务器，不上报任何数据。
      </p>
      <div class="settings-row about-actions">
        <button class="btn small" onClick={() => setOpen('disclaimer')}>
          查看使用须知全文
        </button>
        <button class="btn small" onClick={() => setOpen('licenses')}>
          第三方许可
        </button>
      </div>

      <Dialog
        open={open === 'disclaimer'}
        kind="view"
        title={DISCLAIMER_TITLE}
        confirmLabel="关闭"
        onConfirm={close}
        onCancel={close}
      >
        <div class="legal-scroll" data-testid="legal-disclaimer">
          <MdLite text={DISCLAIMER_FULL_TEXT} />
        </div>
      </Dialog>

      <Dialog
        open={open === 'licenses'}
        kind="view"
        title="第三方组件与许可"
        confirmLabel="关闭"
        onConfirm={close}
        onCancel={close}
      >
        {/* 原样文本：许可声明要给人看与随包文件逐字一致的原文（含表格）。 */}
        <div class="legal-scroll" data-testid="legal-licenses">
          <pre class="legal-raw">{THIRD_PARTY_NOTICES_TEXT}</pre>
        </div>
      </Dialog>
    </section>
  )
}
