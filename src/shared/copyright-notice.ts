/**
 * 声明批4（plan 2026-09-11 compliance-disclosure, D3=B / D6=A）: 导出前的版权提醒。
 *
 * 兑现 spec §9 与 README 早已写下、却一直没实现的那句承诺：
 * 「课程资料属学校教学资源，导出时应给出提示」。
 *
 * 触发规则（写清楚，免得日后读成别的意思）：**除用户明确勾选「不再提示」外，
 * 每次导出都先提示**。勾了才把版本写进库；没勾就下次还提示。写库记录的是
 * 「用户看过并免除提醒的**文本版本**」，所以改动 `COPYRIGHT_NOTICE_VERSION`
 * 会让提醒重新出现一次——改的是承诺，就该再看一遍。
 *
 * 措辞纪律同声明层：只陈述能核对的事实，不用法律术语（不含「跨境/出境」）。
 */

/** 提醒文本版本：改动文案即递增，用户会重新看到一次提醒。 */
export const COPYRIGHT_NOTICE_VERSION = 1

export const COPYRIGHT_NOTICE_TITLE = '导出提醒'

export const COPYRIGHT_NOTICE_MESSAGE =
  '课程录像、平台 PPT 与 B 站视频的著作权归学校、教师或原作者。导出文件可能包含课程画面与他人肖像、声音，请仅供个人学习使用，勿公开转发或公开发布。'

export const COPYRIGHT_NOTICE_CHECK_LABEL = '不再提示'

export const COPYRIGHT_NOTICE_CONFIRM_LABEL = '继续导出'
