# 架构与项目结构

> 本文件是 Flash Summary 的架构参考（2026-10-06 从 README 迁出，README 只保留门面所需的最小集）。改动架构后请同步更新本文件与 README 的技术栈一节。

## 进程与模块

```
+-------------------------------------------------------------+
| Renderer (src/renderer, Preact)                             |
| 课程树 / 任务 / 笔记 / 设置三页签 / 追问坞 / 引导卡 / Toast |
+------------------------------+------------------------------+
                               | IPC (contextBridge)
+------------------------------+------------------------------+
| Main (src/main)                                             |
| app-context      assemble library/session/Provider/ffmpeg   |
| ipc              72 channels: school/bilibili/lessons/      |
|                  notes/qa/tasks/settings/providers/         |
|                  feedback/update/log; serial, cancelable    |
| tasks/orchestrator  6-stage pipeline (ASR/multimodal)       |
| media           ffmpeg audio/keyframes/timeout; phash dedup |
|                  retry + Range resume                       |
| providers        OpenAI-compatible client; DPAPI key        |
| school          play-page harvest (url+lessons); course API |
| auth             in-window login; DPAPI session             |
| notes            schema / 5 views / attachments / regen /   |
|                  PDF handout / evidence align / QA context  |
| db               better-sqlite3 + migrations                |
+-------------------------------------------------------------+
```

三进程隔离：`sandbox` + `contextIsolation` 开启；renderer 与主进程只经 `src/shared/bridge.ts` 声明的类型化桥面通信（改桥面形状必须跑 `npm run smoke`，它才是校验桥面的那道门）。

## 技术栈

- **Electron 44 + TypeScript strict**（electron-vite 构建，main/preload/renderer 三进程隔离）
- **Preact**：renderer UI（happy-dom 组件测试）
- **better-sqlite3**：本地资料库（课程/课时/任务/转写/PPT/关键帧/笔记/问答/设置）
- **ffmpeg-static / ffprobe-static**：媒体处理（已打包进安装包）
- **zod**：笔记 JSON schema 校验
- **vitest**：测试；**electron-builder**：NSIS 安装包

## 项目结构

```
src/
  main/       主进程（数据库、任务队列、媒体管线、Provider、IPC handlers、日志）
  preload/    类型化桥接（contextBridge）
  renderer/   Preact UI（课程树/任务/笔记/设置三页签 + 笔记页右侧追问坞，CSS 变量设计系统）
  shared/     main 与 renderer 共享的纯逻辑与类型（notes schema、bridge 契约）
tests/       vitest 用例（含真实 HTTP 集成与六阶段端到端，含 B站源两条 e2e）
scripts/     release.md（发布清单）· verify-asar.mjs（asar 抽验）· smoke-cdp.mjs（进程级烟测）
             · readme-shots.mjs（README 截图管线：真库副本 CDP 实拍 + 钉窗 + 压缩）
             · ui-shots.mjs / ui-probe.mjs（排版实拍与几何探针）· lib/ui-cdp.mjs（共享 CDP 走查）
promo/       宣发宣传动画：promo.html 分镜舞台（1920×1080，t 的纯函数）+ build-assets.mjs 备料
             + main.mjs 渲染宿主；产物 = promo/out/promo.mp4（帧精确、零新依赖）
docs/
  plans/ROADMAP.md         阶段计划（8 阶段 + 验收命令）
  acceptance/MVP.md        spec 第 11 条逐项验收记录（诚实标注人工验证项）
  superpowers/specs/       唯一设计规格
  skills/                  工艺规范（note-craft 笔记工艺 / ui-layout 排版规范）
PROGRESS.md   断点续跑台账（新会话先读它）
```

## 开发命令

```bash
npm run dev          # 开发模式（热重载）
npm run lint         # ESLint
npm run typecheck    # TypeScript strict（node + web 双工程）
npm test             # vitest
npm run build        # electron-vite 构建到 out/
npm run smoke        # 构建并运行 CDP 进程级烟测
npm run dist         # 构建 NSIS 安装包到 release/
npm run verify:asar  # 抽验安装包 asar 与 out/ 一致（发布门禁）
```
