# SEU Summary — ROADMAP

依据规格 `docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md`（唯一设计规格）。
方法：leader（阶段任务书式拆解，每阶段含目标/任务/验收命令/完成判据）；每阶段结束用 neat-freak 做知识收尾。

## 全局约定

- 平台：Windows only；Electron + TypeScript。
- 命令（Phase 0 建立后全程复用）：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`。
- 每阶段 ≥1 个 Conventional Commit；提交前 lint/typecheck/test 必须过；不许 skip/mock 关键路径制造绿灯。
- 进度只认 `PROGRESS.md`；新会话先读它和本文件，不重做已完成阶段。
- 环境实测（2026-08-30）：node v24.15.0、npm 11.12.1、gh 2.89.0 已登录（Andiii208，token 含 repo+workflow）。
- 阶段推进原则：小步提交；中断即从 PROGRESS.md 恢复；同一验收命令连败 3 次换项并在 PROGRESS 记录卡点。

## Phase 0 — 仓库与工程基线

**目标**：可运行的 Electron+TS 脚手架，四条门禁命令全绿，GitHub 私密仓库建立。

**任务**
1. electron-vite 脚手架（main/preload/renderer，TypeScript strict）。
2. ESLint（typescript-eslint flat config）+ vitest；`package.json` scripts：`lint/typecheck/test/build`。
3. README.md（项目定位、命令、隐私红线）、AGENTS.md（工程约定）、PROGRESS.md（进度台账）。
4. CI：GitHub Actions `ci.yml`，windows-latest，跑四条门禁。
5. `gh repo create seu-summary --private --source . --remote origin --push`（先确认 `git remote -v` 为空、diff 无敏感信息）。

**验收命令**：`npm run lint && npm run typecheck && npm test && npm run build`；`git remote -v` 含 origin；`gh repo view --json visibility` = PRIVATE。
**完成判据**：四命令 0 退出；CI 在 GitHub 上对首推提交运行成功（或排队中可见）；README/AGENTS 与脚本事实一致。

## Phase 1 — 数据模型与本地资料库

**目标**：SQLite schema + 迁移机制 + 默认资料库路径（`Documents\SEU Summary\Library`）。
**任务**：better-sqlite3；migrations 目录与版本表；表：courses、lessons、tasks、transcripts、ppt_pages、keyframes、notes（含版本历史）、qa（课时级，外键预留课程级）；路径解析模块。
**验收命令**：`npm test` 覆盖「全新库迁移」「旧版本升级」「外键约束」三类用例。
**完成判据**：迁移测试通过；库路径解析为 Windows Documents 目录。

## Phase 2 — CAS 登录与学校 API 客户端

**目标**：应用内 CAS 登录（BrowserWindow 会话隔离）、会话 DPAPI 加密持久化、课程/课时列表 API 客户端。
**任务**：CAS 登录窗口与 cookie 捕获；DPAPI 封装（Node ffi 或 Electron safeStorage）；API 客户端（课程列表、课时详情、流地址、PPT 接口）；会话过期检测。
**验收命令**：单测覆盖会话序列化/解密往返、API 响应解析（fixture 回放）、过期重登触发逻辑；真机登录做可复现手动验证记录。
**完成判据**：测试过；日志与代码中无 cookie/TGT 落盘明文路径。

## Phase 3 — 任务队列与断点续跑

**目标**：任务状态机 `pending → fetching_course → downloading_video → extracting_audio → transcribing → extracting_visuals → summarizing → succeeded / failed(stage)`；失败重试从失败阶段恢复。
**任务**：队列执行器（串行 + 可见进度）；阶段产物落库；重试复用已完成阶段产物；24h 临时文件启动清理。
**验收命令**：状态机单测（每个阶段失败注入→重试→不重复已完成阶段）；临时清理反向验证（造一个 >24h 假文件→被删→正常文件保留）。
**完成判据**：测试全过且无 skip；失败注入用例证明不重复下载/转写。

## Phase 4 — 媒体管线

**目标**：教师流(1170193-1)音频提取、屏幕流(1170195-5)关键帧（感知哈希去重）、平台 PPT 下载；全景流(1170194-3)不下载。
**任务**：ffmpeg 下载/抽音頻策略（外部 ffmpeg 或打包方案二选一，记录理由）；感知哈希（blockhash 类算法）关键帧去重；PPT 接口对接；临时文件生命周期（音频成功后删音频、抽帧成功后删屏幕流视频）。
**验收命令**：用小样例媒体文件跑通管线单测（不依赖真实网络）；证据（输出文件+元数据）落库可查。
**完成判据**：三类产物落盘并记录证据；临时文件删除有断言。

## Phase 5 — Provider 与 ASR/LLM

**目标**：多 Provider 配置（OpenAI 兼容），能力独立绑定（ASR / 多模态总结 / 可选文本总结）；Key 用 DPAPI 加密存储。
**任务**：Provider CRUD 与能力绑定模型；OpenAI 兼容客户端（ASR whisper 接口 + chat/completions 多模态）；错误分类（网络/鉴权/不支持视觉输入）转用户可读消息；DPAPI 加密 API Key。
**验收命令**：单测用本地 mock HTTP 服务覆盖正常/鉴权失败/不支持视觉输入三类；加解密往返测试。
**完成判据**：测试过；代码与日志扫描无 API Key 明文。

## Phase 6 — 结构化笔记与追问 UI

**目标**：同一 JSON 渲染四种阅读视图（详细/标准/要点/方法论文分析）；追问仅限当前课时（上下文=转写+笔记+PPT+关键帧+历史问答）。
**任务**：笔记 JSON schema 校验；四视图组件；追问对话组件与后端上下文组装；Markdown 导出。
**验收命令**：组件单测（同 JSON 四视图渲染）；上下文组装单测（含课时边界断言）。
**完成判据**：测试过；无课程级问答入口（预留不实现）。

## Phase 7 — 打包安装与最终 MVP 验收

**目标**：Windows 安装包；按 spec 第 11 条逐条验收。
**任务**：electron-builder NSIS 打包（含 ffmpeg 分发策略落地）；干净 Windows 环境安装验证；`docs/acceptance/MVP.md` 逐条记录（不夸大未人工验证项，标注「需真机人工验证」的条目）。
**验收命令**：`npm run build` 产出安装包；CI 绿；MVP.md 存在且逐条有状态。
**完成判据**：ROADMAP/PROGRESS/README/AGENTS 与代码一致；neat-freak 最终收尾（pending/out-of-scope/待删除清单）。

## 风险与替代预案

- better-sqlite3 native 模块在 Electron ABI 下需重建：用 `@electron/rebuild`；失败则换 sql.js（纯 wasm）并记录。
- ffmpeg 不打进安装包的首选方案：要求用户路径可用或首次启动引导下载到资料库 cache；实现时取更简单者并记录理由。
- CAS 页面结构未知：Phase 2 先用真实登录窗口捕获，Playwright 探索脚本仅作参考不迁移。
