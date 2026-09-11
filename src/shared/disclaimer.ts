/**
 * 声明批2（plan 2026-09-11 compliance-disclosure）：使用须知与免责声明的共享文本源。
 *
 * 唯一权威全文是仓库根 `DISCLAIMER.md`；本文件只承载「首启弹窗用的精简九条」与
 * 文本版本号。**版本号必须与 `DISCLAIMER.md` 的 `文本版本` 行一致**——
 * tests/disclaimer.test.ts 直接读该文件比对，改一处不改另一处会红。
 *
 * 写作纪律（plan §四 口吻纪律 + D7 裁决）：只陈述本应用能核对的事实，口语化短句，
 * 每条 1-2 句，**不使用「跨境」「出境」「不可抗力」一类法律术语**，也不做全大写
 * 免责话术。
 */

/** 文本版本：改动任一条款都必须递增此值，并同步更新 `DISCLAIMER.md`。 */
export const DISCLAIMER_TEXT_VERSION = 2

export const DISCLAIMER_TITLE = '使用须知与免责声明'

/** 弹窗顶部一句导语（标题下方、条款上方）。 */
export const DISCLAIMER_CONSENT_PROMPT = '开始使用前，请先了解以下九点。勾选下方选项即表示你已阅读并同意。'

/** 勾选框文案与两个动作的文案（退出应用是真退出，不是「稍后再说」）。 */
export const DISCLAIMER_CONSENT_CHECK_LABEL = '我已阅读并同意上述须知'
export const DISCLAIMER_CONSENT_CONFIRM_LABEL = '同意并继续'
export const DISCLAIMER_CONSENT_EXIT_LABEL = '退出应用'

/** 弹窗底部指向全文的一句（设置页可随时回看）。 */
export const DISCLAIMER_CONSENT_FOOTNOTE = '完整条款随安装包分发，也可在「设置 → 关于与声明」查看。'

export interface DisclaimerClause {
  /** 与 `DISCLAIMER.md` 对应小节同名，便于用户回查全文。 */
  heading: string
  text: string
}

/**
 * 首启弹窗的九条精简版。每条都对应 `DISCLAIMER.md` 的一个小节，措辞比全文更短，
 * 但不得与全文冲突——它比全文短，不说全文里没有的话。
 */
export const DISCLAIMER_CONSENT_CLAUSES: readonly DisclaimerClause[] = [
  {
    heading: '非官方工具',
    text: '本软件由个人开发，与东南大学及其信息化部门、与哔哩哔哩均无隶属或授权关系。'
  },
  {
    heading: '仅限个人学习',
    text: '请使用你本人的账号，只处理你有权访问的课程与视频；不批量抓取、不二次分发、不用于商业用途。'
  },
  {
    heading: '账号风险',
    text: '用第三方工具访问学校平台，可能触发学校的风控或临时锁定；请先确认你的用法符合学校规定。'
  },
  {
    heading: '数据流向',
    text: '音频、视频截图和转写文本会发送到你在设置里自己配置的模型服务商；这些数据在该服务商处的处理与留存，以它的条款为准。'
  },
  {
    heading: '版权与他人权利',
    text: '课程与视频的著作权归学校、教师或原作者；导出的文件可能包含课程画面与他人肖像声音，请勿公开转发或公开发布。'
  },
  {
    heading: '技术边界',
    text: '不处理付费或充电专属内容、不请求会员清晰度、不下载课堂全景流，也不包含任何解密或绕过限制的功能。'
  },
  {
    heading: '本地留存',
    text: '转写、图片与笔记默认保存在本机；失败的任务会暂时保留当次视频直链（超过有效期后自动清除），取消的任务不会保留。'
  },
  {
    heading: '结果仅供参考',
    text: '笔记由 AI 生成，可能出错——请以课程原始内容为准。'
  },
  {
    heading: '按现状提供',
    text: '不承诺始终可用、不承诺结果正确；完整免责条款以随包的 MIT 许可为准。'
  }
]
