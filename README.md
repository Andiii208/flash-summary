# Flash Summary

> 把东南大学科达录播课程变成结构化学习笔记的 Windows 桌面应用。

[![CI](https://github.com/Andiii208/seu-summary/actions/workflows/ci.yml/badge.svg)](https://github.com/Andiii208/seu-summary/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Andiii208/seu-summary)](https://github.com/Andiii208/seu-summary/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![Electron](https://img.shields.io/badge/Electron-44-47848F)

Flash Summary 是一款**本地优先**的 Windows 桌面应用：用你自己的 SEU CAS 账号登录，把科达录播课程（教师流 + 屏幕/PPT 流 + 平台 PPT）自动加工成**多模态结构化笔记**，并支持**当前课时追问**。

- 没有开发者自有服务器——音频、文字、图片只发给**你自己配置**的 ASR / LLM Provider（OpenAI 兼容接口）。
- 你的资料库、转写、关键帧、笔记全部保存在本地。
- 全流程可断点续跑：失败的任务从失败阶段恢复，不重复已完成的工作。

## ✨ 功能

| 模块 | 说明 |
|---|---|
| 🖥️ Preact 界面 | «quiet academia» 设计语言：分层表面 + 渐变强调、任务卡阶段轨道与进度流光、问答气泡、卡片式 toast；CSS 变量设计系统，明暗主题（跟随系统或手动指定） |
| 🔐 平台登录 | 登录在主窗口内完成（进入学校平台授权后自动返回应用并刷新课程）；完成以「课程列表接口真实可用」为准；会话用 Windows DPAPI 加密持久化，重启免登录；JWT 过期本地判定，徽标区分「已登录/已过期/未登录」，重登由你主动点击触发；登录失败如实弹窗提示（导航会卸载原页面，结果经一次性通道带回）；启动即对校园域名绕过系统代理，检测到代理 Fake-IP 接管会给出具体修复指引（`SEU_LOGIN_WINDOW=1` 可回退独立登录窗） |
| 📚 课程/课时 | **「我的学习」聚合区置顶**：已提取（有笔记自动识别）→ 我的收藏（星标，≥2 门可折叠）→ 同课其他老师推荐；全部课程折叠分组按 150 门增量渲染；分页拉取（默认前 4 页 = 2000 门，`courseListMaxPages` 可调，侧栏明示「本地已收录/本次刷新/平台列表约」三口径边界）；课程卡片显示教师·上课时间·教室（与官网一致）；搜索 300ms 防抖（覆盖课程名/教师/学期/教室/讲次/课程号/课时标题）；**课程全屏浏览**（「全部课程」行尾按钮或 Ctrl+K）：近全屏网格 + 学期/来源/状态筛选 + 排序 + 点教师名即筛选，点卡片展开课时、点课时直接选中；手动 ID 后备入口 |
| ⏱️ 任务队列 | 6 阶段流水线**串行执行**，**任意阶段 2 秒内可取消**（下载/转写/关键帧全链路接信号）且如实显示「已取消」；运行卡显示阶段轨道 + 已下载大小/速度；历史记录显示课程·课时名与**教师·上课时间·教室**、可筛选/单条删除/一键清空（自绘确认框）；失败原因翻译成人话；窗口关闭前确认任务去向 |
| 🎬 媒体管线 | 课时详情自播放页收割（视频直链 + 课时目录，主窗口内完成并恢复界面）；教师流取音频（无音频轨自动回退屏幕流）；屏幕流抽关键帧并**感知哈希去重**；全景流按规格不下载；平台 PPT 优先，关键帧补充；ffmpeg 超时（30 分钟）与停滞检测（60 秒无输出即终止） |
| 🗣️ ASR 转写 | 分片转写（默认 120 秒/片——按真实网关校准，解除大请求体上限），拼接保留片偏移，静音分片自动跳过；HTTP 下载支持 **Range 断点续传** |
| 🧠 多模态笔记 | 转写 + **真实 PPT/关键帧图片**（每张带证据ID标注，上限 20 张）→ 多模态模型生成结构化笔记（JSON）；转写带 `[mm:ss]` 时间锚喂入（引文可核验：生成后逐条核对摘引能否在转写里找到，核对不上的降级而非留假引文）；模型输出偏差容错归一（时间戳/证据引用格式过滤，**丢弃计数在生成结果里可见**）；不支持视觉输入时自动回退纯文本；笔记可**一键重新生成**（复用已存转写与关键帧，不重下载），生成后跑**内容体检**、不达标时**自动返修一次**（返修不发图、只采纳确实改善的稿，无论结果都照常出笔记） |
| 📖 五种阅读视图 | 详细笔记（时间线图文卡片）/ 标准总结 / 要点 / 方法论 / **思维导图**——**同一份 JSON** 投影，非多份独立总结；时间线卡片自动绑定课堂关键帧（证据引用精确匹配 → 时间就近兜底）；概念卡带**具体例子**；公式以 **LaTeX 排版**（KaTeX，讲义里仍是矢量文本）、表格与代码块正常渲染（代码块 ≥3 行显示行号，复制不带行号）；导图另有**关系模式**（把概念关联当主结构画成关系图）；导出 **PDF 整册讲义**（封面 + 整页导图 + 图文正文 + 图集，矢量文本）、**Markdown**、**Anki 牌组**、**Obsidian 结构化笔记**（frontmatter + wikilink + 间隔重复卡）、导图 **SVG** 与 **PNG**；复制到剪贴板 |
| ⚙️ 设置 | Provider 预设模板（OpenAI/DeepSeek/硅基流动/小米 MiMo）+「测试连接」探活；任务缓存目录可改（即时生效）、资料库迁移（失败回滚；不产 .bak 快照——源库即兜底）、**资料库备份**（独立入口：SQLite WAL 一致快照另存到自选路径，只含数据库文件）、主题、打开日志目录；**「关于与声明」**（使用须知全文 + 第三方许可 + 测试期反馈入口 + 作者 GitHub 主页） |
| 📺 B站视频源 | 侧栏「B站视频导入」：粘贴视频链接/BV号/b23.tv 短链 → 解析预览（标题/分P列表勾选）→ 应用内扫码登录（SESSDATA DPAPI 加密落盘）→ 与校内课程同规格生成笔记；**字幕优先**（B站 CC/AI 字幕直插，秒级时间戳），无字幕自动回退 **ASR 兜底**（DASH 音频流）；360P 视频流抽关键帧保时间线配图；付费/充电专属内容明确拒绝；导入后自动排队生成 |
| 💬 课时追问 | 上下文 = 本课时转写 + 笔记 + PPT + 关键帧 + 历史问答（严格课时边界） |
| 🗑️ 临时文件治理 | 音频转写成功后删除、视频抽帧成功后删除、>24h 缓存启动时清理（**跳过运行中任务**） |
| 🩹 可诊断性 | 日志落盘（`userData/logs/`，每日轮转、凭据脱敏）、单实例锁（二次启动聚焦主窗口） |

## 🚀 安装

从 [GitHub Releases](https://github.com/Andiii208/seu-summary/releases) 下载最新的安装包，双击安装即可。

- **文件名**：GitHub 会把资产名里的空格换成点，所以下到的是 `Flash.Summary.Setup.<version>.exe`；本地 `npm run dist` 产出的是 `release\Flash Summary Setup <version>.exe`——同一个包，只是分隔符不同。
- 安装程序会先显示**使用须知与第三方许可**（含内置 ffmpeg 的 GPL-3.0 说明与源码获取途径），需点「我同意」才能继续；条款全文随包放在安装目录的 `resources\legal\`。
- 需要 **Windows 10/11 x64**。
- **无需**安装 ffmpeg——安装包已内置 ffmpeg/ffprobe。
- 首次启动会先弹出**使用须知与免责声明**（九条，须勾选同意；不同意则退出应用），随后按引导配置 Provider（ASR 转写 + 多模态总结）。须知文本改版（版本号变化）后会在下次启动重新提示一次。

## 🖥️ 快速开始

1. 双击应用启动，点击「登录 CAS」——主窗口进入学校平台完成授权，成功后自动返回应用，课程树自动刷新（会话加密保存，重启免登录）。
2. 在左侧课程树点击课时（无课时目录的课点「抓取课时目录」；或用「手动添加」输入课程/课时 ID 作为后备）；侧栏搜索可快速定位课程；课程多时点「全部课程」行尾的展开按钮（或 Ctrl+K）进入全屏浏览，用搜索和筛选找到目标课，点卡片展开课时、点课时直接选中。
3. 点「创建并运行」——任务排队并串行执行，界面实时显示阶段与分片进度；需要时点「取消任务」；窗口重载后运行中任务的状态会自动恢复显示。
4. 完成后笔记自动出现，五种视图切换阅读（含思维导图，可点击节点折叠）；点「导出 PDF 讲义」生成整册讲义（A4、封面、页码、含课堂画面），或「导出 Markdown」；「重新生成」仅重跑总结阶段。
5. 在「追问」页针对本课时提问；任务失败时点历史任务中的「重试」——只会从失败阶段继续。
6. 「设置」页可配置 Provider、更改任务缓存目录、迁移资料库、切换主题、打开日志目录。

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (src/renderer, Preact)                        │
│  课程树 · 任务/笔记/追问/设置页签 · 引导卡 · Toast         │
└──────────────────────────┬──────────────────────────────┘
                           │ IPC（contextBridge，类型化 SeuSummaryBridge）
┌──────────────────────────┴──────────────────────────────┐
│  Main (src/main)                                        │
│  app-context —— 一次组装资料库/会话/Provider/ffmpeg/日志  │
│  ipc —— 65 通道：school/providers/tasks/notes/qa/        │
│         lessons/settings/log；任务经串行队列执行，可取消   │
│  tasks/orchestrator —— 6 阶段流水线编排（ASR 分片/多模态）  │
│  media —— ffmpeg 音频/关键帧/超时守卫 · phash 去重 ·       │
│           下载重试+Range 续传                             │
│  providers —— OpenAI 兼容客户端 · DPAPI 加密 Key          │
│  school —— 播放页收割（视频直链+课时目录）· 课程 API 客户端 │
│  auth —— 主窗口内嵌登录 · DPAPI 加密会话                  │
│  notes —— schema 校验 · 五视图块投影 · 附件/重新生成/       │
│           PDF 讲义 · 证据对齐 · 课时追问上下文               │
│  db —— better-sqlite3 + 迁移（课程录播标识/课时回放引用等） │
└─────────────────────────────────────────────────────────┘
```

### 技术栈

- **Electron 44 + TypeScript strict**（electron-vite 构建，main/preload/renderer 三进程隔离，sandbox + contextIsolation 开启）
- **Preact**：renderer UI（happy-dom 组件测试）
- **better-sqlite3**：本地资料库（课程/课时/任务/转写/PPT/关键帧/笔记/问答/设置）
- **ffmpeg-static / ffprobe-static**：媒体处理（已打包进安装包）
- **zod**：笔记 JSON schema 校验
- **vitest**：测试（1393 个用例，131 个文件）；**electron-builder**：NSIS 安装包

### 项目结构

```
src/
  main/       主进程（数据库、任务队列、媒体管线、Provider、IPC handlers、日志）
  preload/    类型化桥接（contextBridge）
  renderer/   Preact UI（课程树/任务/笔记/追问/设置，CSS 变量设计系统）
  shared/     main 与 renderer 共享的纯逻辑与类型（notes schema、bridge 契约）
tests/        131 个测试文件（含真实 HTTP 集成与六阶段端到端，含 B站源两条 e2e）
docs/skills/   工艺规范（note-craft 笔记工艺 / ui-layout 排版规范——改对应链路的会话先读）
scripts/      release.md（发布清单）· verify-asar.mjs（asar 抽验）· smoke-cdp.mjs（进程级烟测）· ui-shots.mjs / ui-probe.mjs（排版实拍与几何探针）
docs/
  plans/ROADMAP.md         阶段计划（8 阶段 + 验收命令）
  plans/2026-08-31-usability-upgrade.md  v0.2.0 升级计划（U1-U5）
  acceptance/MVP.md        spec 第 11 条逐项验收记录（诚实标注人工验证项）
  superpowers/specs/      唯一设计规格
PROGRESS.md   断点续跑台账（新会话先读它）
```

## 🔒 隐私与安全

- **无后端**：所有数据只在你本机与你自己配置的 Provider 之间流动。
- **凭据加密**：CAS 会话（Cookie + JWT）与 API Key 用 **Windows DPAPI** 加密落盘；绝不进入 Git、日志或文档。
- **视频直链**：课时收割得到的完整签名直链只在任务内部做阶段交接——任务**成功后即清除**，**取消时同样清除**；只有**失败**任务会为断点续跑短暂保留，且**超过直链有效期（校内课 6 小时 / B 站 100 分钟）后启动时自动清除**（重试成功、删除任务或清空历史也会立即清除）。课程库只保存去除签名参数的路径段。
- **红线**：严禁提交 `.env`、Cookie、TGT、API Key、`auth_key`、完整视频直链。
- **临时文件**：成功后即删；超过 24h 的缓存启动时自动清理。
- 课程资料属于学校教学资源，请勿公开转发——**七个导出出口（PDF / Markdown / 剪贴板 / Anki / Obsidian 单课时 / Obsidian 整课 / 导图 SVG）都会给出提示**，可勾选「不再提示」。**完整条款见 [使用须知与免责声明](DISCLAIMER.md)**。

## ⚖️ 合规与使用声明

- **非官方工具**：Flash Summary 由个人开发，与**东南大学**及其信息化部门、与**哔哩哔哩**均无隶属、合作或授权关系。
- **个人学习用途**：请使用**你本人**的账号，仅处理你有权访问的内容，不做批量抓取、不二次分发。
- **数据流向**：音频、截图与转写文本只发往**你在设置里自己配置**的第三方 ASR/LLM 服务商——没有开发者自有服务器，不上报任何数据给开发者（无遥测、无埋点、无崩溃上报）。
- **账号风险**：使用第三方工具访问学校平台可能触发学校的安全策略（频率限制、风控、临时锁定），请自行确认符合学校规定。
- **版权**：课程与视频的著作权归学校、教师或原作者；导出的文件可能包含课程画面与他人肖像声音，**请勿公开转发或公开发布**。
- **技术边界**：不处理 B 站付费/充电专属内容、不请求会员清晰度、不下载全景流、不提供批量抓取、**不含任何 DRM 绕过或解密逻辑**。
- **AI 输出可能出错**：笔记由模型生成，请**以课程原始内容为准**。
- **反馈通道只给入口**：应用内的「测试期问题反馈」只展示反馈表二维码与链接，并把**已脱敏**的诊断信息复制到**你自己的剪贴板**——**没有任何自动上报**。失败任务旁有「反馈这个错误」一键取诊断。

> 上表为摘要。**全文（九条）见 [DISCLAIMER.md](DISCLAIMER.md)**；随包分发的第三方组件与许可（含内置 ffmpeg 的 **GPL-3.0** 说明与源码获取途径）见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。应用内可在「设置 → 关于与声明」查看同一份文本。

## ✅ 当前状态

- **v0.2.1 + 可用性整改**：真实课时下载管线全通（播放页收割直链+课时目录；真实单课 810MB 双流→ASR→笔记已跑通）、主窗口内嵌登录与会话过期恢复活体验证通过；2026-09-03 用户实测反馈修复：dev/安装版数据隔离、会话三态（JWT 过期本地判定）、登录失败可见反馈、校园域名代理绕行 + Fake-IP 预检、课程分页拉取（含总量/进度边界明示）、星标「我的课程」置顶 + 同课程其他老师推荐 + 课程时间/教室展示。
- **1393 个测试**（全绿；lint / typecheck / test / build / smoke / CI 六道门禁——2026-09-21 实测，含笔记体验整改 v4、批 D 与 UX 整改批1–批6 + 补批的全部用例）；组合层体检 L1-L3 全绿（见 [docs/health/2026-09-02-combined-audit.md](docs/health/2026-09-02-combined-audit.md)）。
- **已知环境事项**：视频直链域名 dncvsvod 在部分网络路径下被重置（疑似代理分流或平台策略收紧，定性中）——表现为课时收割/播放失败时请检查代理规则或等待平台恢复，详见 [PROGRESS](PROGRESS.md) 失败与卡点节。
- **人工验收项见 [docs/acceptance/MVP.md](docs/acceptance/MVP.md)**：干净机器安装、≥45 分钟课程端到端与 auth_key 时效（真实 CAS 登录、课程拉取、过期重登恢复均已实测）。

## 🧯 常见问题（troubleshooting）

- **课时收割失败 / 播放提示「播放资源获取失败」**：若你在使用 Clash 等代理的 **TUN 模式**（虚拟网卡接管全局流量），学校视频服务器 `dncvsvod.seu.edu.cn` 通常不在常见分流库里，会被送去代理出口而连不上。解决：代理规则加一条 `DOMAIN-SUFFIX,seu.edu.cn,DIRECT`，或临时关闭 TUN 模式。**注意：订阅更新会把自加规则冲掉**——应用检测到 Fake-IP 解析（`nslookup dncvsvod.seu.edu.cn` 返回 172.19.x.x 即中招）会明确提示，重插规则即可。
- **登录跳转白屏 / 平台页超时**：应用已对 `*.seu.edu.cn` 自动绕过系统代理（无需配置）；若仍失败请检查 Clash TUN 是否接管（见上一条）。也可用 `SEU_DIRECT_NET=1` 启动（Chromium 层绕过系统代理，与代理上外网互不影响）。
- **安装版与开发版数据隔离**：安装版使用 `%APPDATA%\seu-summary`，开发运行（`npm run dev` / `npx electron .`）使用 `%APPDATA%\seu-summary-dev`——两者的会话互不相通；课程资料库（文档目录）仍为两者共用。
- **会话频繁过期**：学校平台会话本身有时效，过期后点「登录 CAS」重新授权即可（已保存的资料库与笔记不受影响）。
- **`npm` 报 "cannot execute"**（Windows + git-bash/cygwin 环境）：请使用 `npm.cmd`。

## 🛠️ 开发

```bash
npm install
npm run dev          # 开发模式（热重载）
npm run lint         # ESLint
npm run typecheck    # TypeScript strict（node + web 双工程）
npm test             # vitest（1393 用例 / 131 文件）
npm run build        # electron-vite 构建到 out/
npm run smoke        # 构建并运行 CDP 进程级烟测（38 项组合断言）
npm run dist         # 构建 NSIS 安装包到 release/
npm run verify:asar  # 抽验安装包 asar 与 out/ 一致（发布门禁）
```

CI（GitHub Actions，windows-latest）在每个 push 上运行 lint + typecheck + test + build。

> 环境提示：Windows 上若 `npm` 直接调用报 "cannot execute"，请用 `npm.cmd`。

## 📖 更多文档

- [设计规格](docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md)（唯一规格来源）
- [使用须知与免责声明](DISCLAIMER.md)（九条全文，应用内同源）
- [第三方组件与许可](THIRD-PARTY-NOTICES.md)（含 ffmpeg GPL-3.0 说明）
- [ROADMAP](docs/plans/ROADMAP.md)（阶段计划与验收命令）
- [MVP 验收记录](docs/acceptance/MVP.md)（spec 第 11 条逐项）
- [AGENTS.md](AGENTS.md)（工程约定，供 AI 协作者）

## 🤝 贡献

MVP 范围明确不做：云端同步、多用户、本地 ASR、macOS。
已交付并超出初版 MVP 边界（均经用户批准，见 [ROADMAP](docs/plans/ROADMAP.md) 与相应方案）：PDF 讲义导出（2026-09-04）、**B 站作为第二视频源**（2026-09-06）、Obsidian / Anki 结构化导出（2026-09-08）。
欢迎在 issue 中讨论需求；改动请保持小而聚焦的 Conventional Commits，并在提交前通过全部门禁。

## 📄 License

[MIT](LICENSE)
