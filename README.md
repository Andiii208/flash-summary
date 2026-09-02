# SEU Summary

> 把东南大学科达录播课程变成结构化学习笔记的 Windows 桌面应用。

[![CI](https://github.com/Andiii208/seu-summary/actions/workflows/ci.yml/badge.svg)](https://github.com/Andiii208/seu-summary/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Andiii208/seu-summary)](https://github.com/Andiii208/seu-summary/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![Electron](https://img.shields.io/badge/Electron-44-47848F)

SEU Summary 是一款**本地优先**的 Windows 桌面应用：用你自己的 SEU CAS 账号登录，把科达录播课程（教师流 + 屏幕/PPT 流 + 平台 PPT）自动加工成**多模态结构化笔记**，并支持**当前课时追问**。

- 没有开发者自有服务器——音频、文字、图片只发给**你自己配置**的 ASR / LLM Provider（OpenAI 兼容接口）。
- 你的资料库、转写、关键帧、笔记全部保存在本地。
- 全流程可断点续跑：失败的任务从失败阶段恢复，不重复已完成的工作。

## ✨ 功能

| 模块 | 说明 |
|---|---|
| 🖥️ Preact 界面 | 组件化三区布局（课程树 / 主区页签 / 引导卡），CSS 变量设计系统，明暗主题（跟随系统或手动指定） |
| 🔐 SEU CAS 登录 | 应用内登录窗口；会话用 Windows DPAPI 加密持久化，重启免登录；过期后徽章如实提示未登录，重登由你主动点击触发（不做静默自动弹窗） |
| 📚 课程/课时 | 一次性拉取课程→课时树（含「已处理」徽标）；支持手动输入课程/课时 ID 作为后备入口 |
| ⏱️ 任务队列 | 6 阶段流水线**串行执行**（同一时刻至多 1 个任务），实时阶段进度 + 分片进度，失败重试（从失败阶段恢复，复用已完成产物），支持取消 |
| 🎬 媒体管线 | 教师流(`1170193-1`)取音频；屏幕流(`1170195-5`)抽关键帧并**感知哈希去重**；全景流(`1170194-3`)按规格不下载；平台 PPT 优先，关键帧补充；ffmpeg 超时（30 分钟）与停滞检测（60 秒无输出即终止） |
| 🗣️ ASR 转写 | 按 **10 分钟分片**转写（解除 25MB 上限，45 分钟以上课程可用），拼接保留片偏移；HTTP 下载支持 **Range 断点续传** |
| 🧠 多模态笔记 | 转写 + **真实 PPT/关键帧图片**（base64，上限 20 张）→ 多模态模型生成结构化笔记（JSON）；模型不支持视觉输入时自动回退纯文本 |
| 📖 四种阅读视图 | 详细笔记 / 标准总结 / 要点 / 方法论分析——**同一份 JSON** 投影，非四份独立总结；一键导出 Markdown（系统另存为对话框） |
| ⚙️ 设置 | 任务缓存目录可改（即时生效）、资料库迁移（备份 + 失败回滚）、主题、Provider 管理、打开日志目录 |
| 💬 课时追问 | 上下文 = 本课时转写 + 笔记 + PPT + 关键帧 + 历史问答（严格课时边界） |
| 🗑️ 临时文件治理 | 音频转写成功后删除、视频抽帧成功后删除、>24h 缓存启动时清理（**跳过运行中任务**） |
| 🩹 可诊断性 | 日志落盘（`userData/logs/`，每日轮转、凭据脱敏）、单实例锁（二次启动聚焦主窗口） |

## 🚀 安装

从 [GitHub Releases](https://github.com/Andiii208/seu-summary/releases) 下载最新的
`SEU.Summary.Setup.<version>.exe`，双击安装即可。

- 需要 **Windows 10/11 x64**。
- **无需**安装 ffmpeg——安装包已内置 ffmpeg/ffprobe。
- 首次启动后按引导配置 Provider（ASR 转写 + 多模态总结）。

## 🖥️ 快速开始

1. 双击应用启动，点击「登录 CAS」用 SEU 账号登录（会话会被加密保存），课程树自动刷新。
2. 在左侧课程树点击课时（或用「手动添加」输入课程/课时 ID 作为后备）。
3. 点「创建并运行」——任务排队并串行执行，界面实时显示阶段与分片进度；需要时点「取消任务」。
4. 完成后笔记自动出现，四种视图切换阅读；点「导出 Markdown」另存为文件。
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
│  ipc —— 28 通道：school/providers/tasks/notes/qa/        │
│         settings/log；任务经串行队列执行，可取消           │
│  tasks/orchestrator —— 6 阶段流水线编排（ASR 分片/多模态）  │
│  media —— ffmpeg 音频/关键帧/超时守卫 · phash 去重 ·       │
│           下载重试+Range 续传                             │
│  providers —— OpenAI 兼容客户端 · DPAPI 加密 Key          │
│  school —— CAS 会话 · 课程/课时 API 客户端                │
│  notes —— schema 校验 · 四视图投影 · 课时追问上下文         │
│  db —— better-sqlite3 + 迁移（11 张表 + settings +        │
│         error_kind）                                     │
└─────────────────────────────────────────────────────────┘
```

### 技术栈

- **Electron 44 + TypeScript strict**（electron-vite 构建，main/preload/renderer 三进程隔离，sandbox + contextIsolation 开启）
- **Preact**：renderer UI（happy-dom 组件测试）
- **better-sqlite3**：本地资料库（课程/课时/任务/转写/PPT/关键帧/笔记/问答/设置）
- **ffmpeg-static / ffprobe-static**：媒体处理（已打包进安装包）
- **zod**：笔记 JSON schema 校验
- **vitest**：测试（221 个用例，38 个文件）；**electron-builder**：NSIS 安装包

### 项目结构

```
src/
  main/       主进程（数据库、任务队列、媒体管线、Provider、IPC handlers、日志）
  preload/    类型化桥接（contextBridge）
  renderer/   Preact UI（课程树/任务/笔记/追问/设置，CSS 变量设计系统）
  shared/     main 与 renderer 共享的纯逻辑与类型（notes schema、bridge 契约）
tests/        38 个测试文件（含真实 HTTP 集成与六阶段端到端）
scripts/      release.md（发布清单）· verify-asar.mjs（asar 抽验）· smoke-cdp.mjs（进程级烟测）
docs/
  plans/ROADMAP.md         阶段计划（8 阶段 + 验收命令）
  plans/2026-08-31-usability-upgrade.md  v0.2.0 升级计划（U1-U5）
  acceptance/MVP.md        spec 第 11 条逐项验收记录（诚实标注人工验证项）
  superpowers/specs/      唯一设计规格
PROGRESS.md   断点续跑台账（新会话先读它）
```

## 🔒 隐私与安全

- **无后端**：所有数据只在你本机与你自己配置的 Provider 之间流动。
- **凭据加密**：CAS 会话与 API Key 用 **Windows DPAPI** 加密落盘；绝不进入 Git、日志或文档。
- **红线**：严禁提交 `.env`、Cookie、TGT、API Key、`auth_key`、完整视频直链。
- **临时文件**：成功后即删；超过 24h 的缓存启动时自动清理。
- 课程资料属于学校教学资源，请勿公开转发（应用导出时会有提示）。

## ✅ 当前状态

- **8 个基础阶段 + v0.2.0 可用性升级（U1-U5）全部完成**：主流程修复 → Preact UI → 设置与下载位置 → 管线质量（ASR 分片/多模态发图/队列/取消）→ 基建与发布。
- **221 个测试全绿**（lint / typecheck / test / build / smoke / CI 六道门禁）；组合层体检 L1-L3 全绿（见 [docs/health/2026-09-02-combined-audit.md](docs/health/2026-09-02-combined-audit.md)）。
- 已发布 v0.2.0 安装包；当前在 v0.2.1 稳定化：唯一活堵点是 CAS 登录窗口间歇挂起（诊断手册见 `docs/diagnostics/`）。
- **人工验收项见 [docs/acceptance/MVP.md](docs/acceptance/MVP.md)**：干净机器安装、≥45 分钟课程端到端、会话过期重登恢复（真实 CAS 登录与课程拉取已实测，字段精修待真实样本）。

## 🛠️ 开发

```bash
npm install
npm run dev          # 开发模式（热重载）
npm run lint         # ESLint
npm run typecheck    # TypeScript strict（node + web 双工程）
npm test             # vitest（221 用例）
npm run build        # electron-vite 构建到 out/
npm run smoke        # 构建并运行 CDP 进程级烟测（19 项组合断言）
npm run dist         # 构建 NSIS 安装包到 release/
npm run verify:asar  # 抽验安装包 asar 与 out/ 一致（发布门禁）
```

CI（GitHub Actions，windows-latest）在每个 push 上运行 lint + typecheck + test + build。

> 环境提示：Windows 上若 `npm` 直接调用报 "cannot execute"，请用 `npm.cmd`。

## 📖 更多文档

- [设计规格](docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md)（唯一规格来源）
- [ROADMAP](docs/plans/ROADMAP.md)（阶段计划与验收命令）
- [MVP 验收记录](docs/acceptance/MVP.md)（spec 第 11 条逐项）
- [AGENTS.md](AGENTS.md)（工程约定，供 AI 协作者）

## 🤝 贡献

MVP 范围明确不做：B 站、云端同步、多用户、本地 ASR、PDF 导出、macOS。
欢迎在 issue 中讨论需求；改动请保持小而聚焦的 Conventional Commits，并在提交前通过全部门禁。

## 📄 License

[MIT](LICENSE)
