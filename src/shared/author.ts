/**
 * 作者入口（2026-09-21）：设置页「关于与声明」里的 GitHub 主页链接。
 *
 * 与反馈通道同一条红线（AGENTS.md 安全红线）：**地址只存在于 main 侧，打开外链
 * 的 IPC 不接参数**——渲染层无法让 main 打开任意 URL，否则就是一个 openExternal
 * 注入洞。沿用 `feedback:openForm` 与 `settings:openPath` 的无参/枚举先例。
 */

/** 作者的 GitHub 主页。 */
export const AUTHOR_GITHUB_URL = 'https://github.com/Andiii208'

/** 按钮文案（与 URL 同源，改地址不必翻组件）。 */
export const AUTHOR_GITHUB_LABEL = '作者的 GitHub 主页'
