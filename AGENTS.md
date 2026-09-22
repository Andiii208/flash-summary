# AGENTS.md — Flash Summary 工程约定

面向在本仓库工作的 AI agent 与人类协作者。

## 事实基线

- 唯一设计规格：`docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md`，其他文档不得与其冲突；发现冲突以 spec 为准并修文档。
- 阶段计划：`docs/plans/ROADMAP.md`；进度台账：`PROGRESS.md`（新会话先读，不重做已完成阶段）。
- 技术栈：Electron + TypeScript（strict），main/preload/renderer 三进程结构，代码在 `src/`，测试在 `tests/`。
- 平台 Windows only。
- **命名现状（故意保留，勿「顺手统一」）**：产品展示名 **Flash Summary**；npm 包名 / userData 目录 `seu-summary`（`%APPDATA%\seu-summary`）；仓库名 `Andiii208/flash-summary`（2026-09-23 经用户要求从 seu-summary 更名，旧地址由 GitHub 自动重定向）；appId `edu.seu.summary`；`LICENSE` 署名为 "SEU Summary contributors"。改 `name`/`appId` 会丢登录态与已加密密钥（红线）；2026-09-11 D4 裁决 = **不改**，改由声明层写明「非官方、无隶属关系」。

## 命令（提交前必须全过）

```bash
npm run lint && npm run typecheck && npm test
```

- `npm run build` 为 electron-vite 构建（Phase 7 起含安装包打包）。
- **改了 IPC 契约 / 桥面（`src/shared/bridge.ts`、`preload`、`ipc.ts` 的返回结构）时，四门禁之外必须另跑 `npm run smoke`**——它才是校验桥面形状的那道门（2026-09-18 实锤：批C1 把两条列表改成 `{items,total,limit}`，四门禁全绿而 smoke 30/32）。
- 测试不许 skip/todo/删除断言/mock 被测关键路径来制造绿灯；测试数只增不减。

## 提交纪律

- Conventional Commits（feat:/fix:/docs:/chore:/test:），小而聚焦。
- push 前 `git status` 只含本阶段目标文件。
- 每阶段结束跑 neat-freak 式一致性检查：README/AGENTS/docs 与代码事实一致，只保留一个现役答案；发现待删残留列清单不擅自删除。

## UI 约定（2026-09-08 批6 收口）

- busy 视觉：慢操作一律「文案加省略号 + disabled」（如「添加中…」），hook 侧做 in-flight 守卫防连点；不新增第三种 busy 形态。
- 模态层统一用共享 `ui/Dialog`（含滚动锁/Esc/居中遮罩）；自绘弹层必须挂 `useModalScrollLock`。
- 笔记字段里的用户可见文本一律经 `MdLite`/`InlineText` 渲染——模型会自由输出 `**加粗**`，纯文本插值会印出字面星号。
- **排版（间距/行高/字距/断点/基元/主题色）的唯一事实源是 `docs/skills/ui-layout/SKILL.md`**（2026-09-18 排版整改八批沉淀）：刻度 token 只取那几档、同一角色只允许一处定义、宽度断点只有 1180/1024（窄窗）——宽屏方向不用 CSS 断点，用 main 侧窗口缩放（`src/main/window-zoom.ts`，CSS 视口钉 1600；2026-09-21 P28 落地、批6 的 1600 宽屏档已删）；追问坞档 1400 是唯一例外（P36，与缩放同批协调）——都有钉住测试（`tests/style-scale.test.ts` 等）。改 renderer 样式前先读它。

## 声明层纪律（2026-09-11 起，违反即「设计声明与实现漂移」复发）

- **唯一文本源**：用户可见的完整声明是仓库根 `DISCLAIMER.md`（九条）。应用内文本版本号钉在 `src/shared/disclaimer.ts`，必须与 `DISCLAIMER.md` 的 `文本版本` 行一致（有钉住测试断言）。
- **新增任何用户可见承诺，先进 spec §9「User-facing disclosure layer」，再落实现**——spec 是唯一规格来源，不允许代码先行。
- **只写能核对的事实**：声明里每句话都必须能在源码里找到依据。写不实的承诺比不写更有害。**不出现法律术语**（「跨境」「出境」「不可抗力」等一律不用，见 2026-09-11 D7 裁决）。
- **落点分工**：拦路弹窗只陈述事实、口语化短句、每条 ≤2 行；细节放设置页与「用户正在做选择」的位置（如 Provider 配置区）。
- **新增运行时依赖 → 必须同步 `THIRD-PARTY-NOTICES.md` 一行 + 把许可文本放进 `LICENSES/`**；升级 `ffmpeg-static` 或更换媒体二进制后必须同步更新该文件里的版本、构建配置与来源链接。
- **反馈通道只给入口、不上报**：应用不得向开发者发送任何数据（无埋点、无自动上报）。若将来要加任何自动上报，属于产品边界变更，先问用户。

## 安全红线（违反即失败）

- 不提交：.env、Cookie、TGT、API Key、auth_key、完整视频直链。
- 凭据与学校会话用 Windows DPAPI 加密后落盘；日志不含敏感值。
- 用户数据（Library/）不入 Git。
- **打开外部网址只能经 main 侧的固定常量**（形如 `settings:openPath` 的枚举/无参 IPC）。绝不接受渲染层传入的任意 URL——那是 `openExternal` 注入洞。

## 范围

- MVP 不做：云端同步、多用户、本地 ASR、macOS。
- **B 站源已立项**（2026-09-06 用户批准「全按推荐」）：方案 docs/plans/2026-09-06-bilibili-source-integration.md；字幕优先+ASR 兜底，不碰付费/充电专属内容，不批量抓取。
- **PDF 导出已转正**（2026-09-04 用户批准，Note Revolution 计划）：主窗口 printToPDF 整册讲义，非 MVP 边界回退项。
- 改变产品边界的决定先问用户；纯实现细节选更简单方案并在 PROGRESS.md 记录理由。
