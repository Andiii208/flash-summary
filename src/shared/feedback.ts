/**
 * 声明批6（plan 2026-09-11 compliance-disclosure）: 测试期问题反馈通道。
 *
 * **红线：这条通道只给入口、不上报。** 应用不向开发者发送任何数据——没有埋点、
 * 没有自动提交、没有远程配置。用户能做的只有三件事：扫码/点按钮打开反馈表、
 * 把**诊断信息复制到自己的剪贴板**、自己粘贴提交。这样 spec §9「没有开发者自有
 * 服务器」的承诺不因为「收集反馈」而动摇。
 *
 * 反馈表链接放在这里由 main 侧取用；打开外链的 IPC **不接参数**，渲染层无法让
 * main 打开任意地址（AGENTS.md 的安全红线）。
 */

/** 腾讯文档**收集表**（`/form/page/…` 形态：可匿名填写，无需编辑权限）。 */
export const FEEDBACK_FORM_URL = 'https://docs.qq.com/form/page/DQVJUZ3hHaHRKSXhW'

export const FEEDBACK_TITLE = '测试期问题反馈'

export const FEEDBACK_HINT = '这是测试版本。遇到 bug、异常报错或想提建议，扫码或用下面的按钮打开反馈表填写。'

/** 复制诊断信息时的隐私提醒——我们主动给了「复制」按钮，就必须同时说清别复制什么。 */
export const FEEDBACK_SENSITIVE_HINT = '请勿粘贴账号密码、Cookie、API Key 或视频直链。'

export const FEEDBACK_OPEN_LABEL = '在浏览器打开反馈表'
export const FEEDBACK_COPY_LABEL = '复制诊断信息'
export const FEEDBACK_DIAGNOSTICS_TITLE = '反馈这个错误'
export const FEEDBACK_DIAGNOSTICS_HINT = '下面是可以随反馈一起提交的诊断信息（不含账号与密钥）。复制后粘贴到反馈表即可。'
