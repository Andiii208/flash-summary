# AGENTS.md — SEU Summary 工程约定

面向在本仓库工作的 AI agent 与人类协作者。

## 事实基线

- 唯一设计规格：`docs/superpowers/specs/2026-08-30-seu-summary-desktop-mvp-design.md`，其他文档不得与其冲突；发现冲突以 spec 为准并修文档。
- 阶段计划：`docs/plans/ROADMAP.md`；进度台账：`PROGRESS.md`（新会话先读，不重做已完成阶段）。
- 技术栈：Electron + TypeScript（strict），main/preload/renderer 三进程结构，代码在 `src/`，测试在 `tests/`。
- 平台 Windows only。

## 命令（提交前必须全过）

```bash
npm run lint && npm run typecheck && npm test
```

- `npm run build` 为 electron-vite 构建（Phase 7 起含安装包打包）。
- 测试不许 skip/todo/删除断言/mock 被测关键路径来制造绿灯；测试数只增不减。

## 提交纪律

- Conventional Commits（feat:/fix:/docs:/chore:/test:），小而聚焦。
- push 前 `git status` 只含本阶段目标文件。
- 每阶段结束跑 neat-freak 式一致性检查：README/AGENTS/docs 与代码事实一致，只保留一个现役答案；发现待删残留列清单不擅自删除。

## 安全红线（违反即失败）

- 不提交：.env、Cookie、TGT、API Key、auth_key、完整视频直链。
- 凭据与学校会话用 Windows DPAPI 加密后落盘；日志不含敏感值。
- 用户数据（Library/）不入 Git。

## 范围

- MVP 不做：云端同步、多用户、本地 ASR、macOS。
- **B 站源已立项**（2026-09-06 用户批准「全按推荐」）：方案 docs/plans/2026-09-06-bilibili-source-integration.md；字幕优先+ASR 兜底，不碰付费/充电专属内容，不批量抓取。
- **PDF 导出已转正**（2026-09-04 用户批准，Note Revolution 计划）：主窗口 printToPDF 整册讲义，非 MVP 边界回退项。
- 改变产品边界的决定先问用户；纯实现细节选更简单方案并在 PROGRESS.md 记录理由。
