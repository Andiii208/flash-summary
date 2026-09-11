/**
 * 声明批3（plan 2026-09-11 compliance-disclosure）: the disclosure documents the
 * app shows under «设置 → 关于与声明».
 *
 * 用 `?raw` 在**构建期**内联，而不是运行时读盘：
 *  - 开发版与安装版拿到的一定是同一份文本（没有 resourcesPath / asar 的分叉要处理）；
 *  - 文本成为构建产物的一部分——改了文件不重新构建，界面与随包文件不可能不一致。
 *
 * 唯一权威仍是仓库根的那两个文件；这里只是把它们搬进 UI，不复制内容。
 */
import disclaimerRaw from '../../DISCLAIMER.md?raw'
import noticesRaw from '../../THIRD-PARTY-NOTICES.md?raw'

/** 使用须知与免责声明全文（九条）。 */
export const DISCLAIMER_FULL_TEXT = disclaimerRaw

/** 第三方组件与许可声明（含内置 ffmpeg 的 GPL-3.0 说明与源码获取途径）。 */
export const THIRD_PARTY_NOTICES_TEXT = noticesRaw

/** `[label](url)` → `label`。见下方注释：链接是**故意**不渲染的。 */
function deLink(line: string): string {
  return line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}

/**
 * 声明批3 收口（2026-09-11 双主题截图走查发现）: prepare a repo document for the in-app reader.
 *
 * 走查实拍到的三类问题——这两份文件是**写给仓库读者**的（GitHub 渲染成网页），把源文
 * 直接搬进弹窗会漏给终端用户：
 *   ① 文档自己的 H1 与弹窗标题重复（弹窗里出现两行「使用须知与免责声明」）；
 *   ② 开头的维护者说明（「请勿在未同步更新 `src/shared/disclaimer.ts` 的情况下单独改动
 *      本文件」）——对用户毫无意义，只制造困惑；
 *   ③ 字面 markdown 记号：`---` 分隔线、`**加粗**`、`[label](url)`。
 * ①②在这里去掉，③交给 MdLite 渲染（表格已支持）。
 *
 * **链接降级为纯文本，这是有意的**：我们不给 MdLite 加链接渲染，因为渲染层 CSP 是
 * `default-src 'self'`，而可点链接会把主窗口导航走——这条路径在笔记渲染（模型产出）里
 * 同样存在，不能为了这份文档破例。降级规则是 `[标签](网址)` → `标签`：**裸网址**
 * （文档里写成 `<https://…>` 的那种）原样保留，而 GPL 合规要紧的那几个网址——ffmpeg
 * 源码获取途径与构建页——在 THIRD-PARTY-NOTICES.md 里正是裸网址形式，所以不会被丢。
 */
export function toReaderMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let seenHeading = false
  /** Only the LEADING blockquote block is maintainer metadata; later quotes are content. */
  let inLeadingBlock = true
  for (const line of lines) {
    const trimmed = line.trim()
    if (!seenHeading && /^#\s+/.test(trimmed)) {
      seenHeading = true
      continue
    }
    if (/^#{1,6}\s+/.test(trimmed)) seenHeading = true
    if (inLeadingBlock && trimmed.startsWith('>')) continue
    if (trimmed !== '') inLeadingBlock = false
    if (/^-{3,}$/.test(trimmed)) continue
    out.push(deLink(line))
  }
  // Collapse the blank runs the removals left behind.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
